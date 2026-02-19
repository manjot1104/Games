import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Platform,
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
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 6;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRUM_SIZE = 140;
const BEAT_INTERVAL = 2000; // 2 seconds between beats

const DrumDuoGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftTapped, setLeftTapped] = useState(false);
  const [rightTapped, setRightTapped] = useState(false);
  const [waitingForBeat, setWaitingForBeat] = useState(false);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftRotation = useSharedValue(0);
  const rightRotation = useSharedValue(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const beatTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerBeat = useCallback(() => {
    if (done) return;
    setWaitingForBeat(true);
    setLeftTapped(false);
    setRightTapped(false);
    
    speakTTS('Tap both drums!', 0.8, 'en-US');
    
    // Visual cue
    leftScale.value = withSequence(
      withSpring(1.2),
      withSpring(1)
    );
    rightScale.value = withSequence(
      withSpring(1.2),
      withSpring(1)
    );
  }, [done, leftScale, rightScale]);

  const handleLeftDrum = useCallback(() => {
    if (done || !waitingForBeat || leftTapped) return;
    setLeftTapped(true);
    leftScale.value = withSequence(
      withSpring(0.8),
      withSpring(1)
    );
    leftRotation.value = withSequence(
      withSpring(-5),
      withSpring(0)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    
    if (rightTapped) {
      // Both tapped! Score increases immediately
          setScore((s) => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound((r) => r + 1);
                triggerBeat();
              }, 1500);
            }
            return newScore;
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!', 0.9, 'en-US');
    }
  }, [done, waitingForBeat, leftTapped, rightTapped, leftScale, leftRotation, triggerBeat, endGame]);

  const handleRightDrum = useCallback(() => {
    if (done || !waitingForBeat || rightTapped) return;
    setRightTapped(true);
    rightScale.value = withSequence(
      withSpring(0.8),
      withSpring(1)
    );
    rightRotation.value = withSequence(
      withSpring(5),
      withSpring(0)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    
    if (leftTapped) {
      // Both tapped! Score increases immediately
          setScore((s) => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound((r) => r + 1);
                triggerBeat();
              }, 1500);
            }
            return newScore;
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!', 0.9, 'en-US');
    }
  }, [done, waitingForBeat, leftTapped, rightTapped, rightScale, rightRotation, triggerBeat, endGame]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setWaitingForBeat(false);

    if (beatTimerRef.current) {
      clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      beatTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'drum-duo',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm', 'coordination', 'two-hand-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setTimeout(() => {
        triggerBeat();
      }, 500);
    }
  }, [showInfo, round, done, triggerBeat]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (beatTimerRef.current) {
        clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
    };
  }, []);

  const leftDrumStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: leftScale.value },
      { rotate: `${leftRotation.value}deg` },
    ],
  }));

  const rightDrumStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: rightScale.value },
      { rotate: `${rightRotation.value}deg` },
    ],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Drum Duo"
        emoji="🥁"
        description="Tap both drums together in rhythm!"
        skills={['Rhythm', 'Coordination']}
        suitableFor="Children learning rhythm and coordination through dual drum tapping"
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
            triggerBeat();
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
        <Text style={styles.title}>Drum Duo</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🥁 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {waitingForBeat ? 'Tap both drums!' : 'Get ready...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.drumsContainer}>
          <TouchableOpacity
            style={styles.drumWrapper}
            onPress={handleLeftDrum}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.drum, styles.leftDrum, leftDrumStyle]}>
              <Text style={styles.drumEmoji}>🥁</Text>
              <Text style={styles.drumLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.drumWrapper}
            onPress={handleRightDrum}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.drum, styles.rightDrum, rightDrumStyle]}>
              <Text style={styles.drumEmoji}>🥁</Text>
              <Text style={styles.drumLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Rhythm • Coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Tap both drums together in rhythm!
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
    color: '#F59E0B',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  drumsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  drumWrapper: {
    width: DRUM_SIZE,
    height: DRUM_SIZE,
  },
  drum: {
    width: DRUM_SIZE,
    height: DRUM_SIZE,
    borderRadius: DRUM_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftDrum: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  rightDrum: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  drumEmoji: {
    fontSize: 60,
    marginBottom: 5,
  },
  drumLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
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

export default DrumDuoGame;
