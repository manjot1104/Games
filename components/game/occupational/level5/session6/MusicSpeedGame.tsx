import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech, playSound } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 80;
const TOLERANCE = 50;
const BEAT_INTERVAL = 1000; // 1 second per beat

const MusicSpeedGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [beatCount, setBeatCount] = useState(0);
  const [targetVisible, setTargetVisible] = useState(false);
  
  const targetX = useSharedValue(SCREEN_WIDTH * 0.5);
  const targetY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const targetScale = useSharedValue(1);
  const targetOpacity = useSharedValue(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const beatTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startBeat = useCallback(() => {
    setBeatCount(0);
    setTargetVisible(false);
    
    const playBeat = () => {
      playSound('drum', 0.6, 1.0);
      setBeatCount((prev) => {
        const newCount = prev + 1;
        
        // Show target on every 3rd beat
        if (newCount % 3 === 0) {
          targetX.value = Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2;
          targetY.value = Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100;
          targetOpacity.value = withTiming(1, { duration: 200 });
          targetScale.value = withSpring(1.2, {}, () => {
            targetScale.value = withSpring(1);
          });
          setTargetVisible(true);
          
          // Hide after short time
          setTimeout(() => {
            targetOpacity.value = withTiming(0, { duration: 200 });
            setTargetVisible(false);
          }, 800);
        }
        
        return newCount;
      });
    };

    // Play initial beat
    playBeat();
    
    beatTimerRef.current = setInterval(playBeat, BEAT_INTERVAL);
  }, [targetX, targetY, targetOpacity, targetScale]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || !targetVisible) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - targetX.value, 2) + Math.pow(tapY - targetY.value, 2)
    );

    if (distance <= TOLERANCE + TARGET_SIZE / 2) {
      targetOpacity.value = withTiming(0, { duration: 200 });
      setTargetVisible(false);

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          if (beatTimerRef.current) {
            clearInterval(beatTimerRef.current);
          }
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            startBeat();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('On beat!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, targetVisible, targetX, targetY, targetOpacity, startBeat]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 18;
    const accuracy = (finalScore / total) * 100;

    if (beatTimerRef.current) {
      clearInterval(beatTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'music-speed',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['auditory-visual-sync', 'rhythm', 'timing'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      startBeat();
      setTimeout(() => {
        speakTTS('Tap on the beat!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, startBeat]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (beatTimerRef.current) {
        clearInterval(beatTimerRef.current);
      }
    };
  }, []);

  const targetStyle = useAnimatedStyle(() => ({
    left: targetX.value - TARGET_SIZE / 2,
    top: targetY.value - TARGET_SIZE / 2,
    transform: [{ scale: targetScale.value }],
    opacity: targetOpacity.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Music Speed"
        emoji="🎵"
        description="Tap the target on the beat! Build auditory and visual sync."
        skills={['Auditory + visual sync']}
        suitableFor="Children learning rhythm and timing coordination"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            startBeat();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Music Speed</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap on the beat!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        <Animated.View style={[styles.target, targetStyle]}>
          <Text style={styles.targetEmoji}>🎯</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Auditory + visual sync
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the target on the beat!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#6366F1',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.6,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  targetEmoji: {
    fontSize: 40,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default MusicSpeedGame;
