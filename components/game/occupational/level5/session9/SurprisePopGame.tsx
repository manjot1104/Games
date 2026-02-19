import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const POP_SIZE = 100;
const TOLERANCE = 60;
const MIN_DELAY = 1000;
const MAX_DELAY = 4000;

const SurprisePopGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const popX = useSharedValue(SCREEN_WIDTH * 0.5);
  const popY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const popOpacity = useSharedValue(0);
  const popScale = useSharedValue(0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const popTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [popActive, setPopActive] = useState(false);

  const showPop = useCallback(() => {
    popX.value = Math.random() * (screenWidth.current - POP_SIZE) + POP_SIZE / 2;
    popY.value = Math.random() * (screenHeight.current - POP_SIZE - 200) + POP_SIZE / 2 + 100;
    
    popScale.value = 0.5;
    popOpacity.value = withTiming(1, { duration: 200 });
    popScale.value = withSpring(1, {}, () => {
      popScale.value = withSpring(1.1);
    });
    setPopActive(true);

    // Hide after 1 second
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }
    popTimerRef.current = setTimeout(() => {
      popOpacity.value = withTiming(0, { duration: 200 });
      setPopActive(false);
    }, 1000);
  }, [popX, popY, popOpacity, popScale]);

  const scheduleNextPop = useCallback(() => {
    const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }
    popTimerRef.current = setTimeout(() => {
      showPop();
    }, delay);
  }, [showPop]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || !popActive) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - popX.value, 2) + Math.pow(tapY - popY.value, 2)
    );

    if (distance <= TOLERANCE + POP_SIZE / 2) {
      if (popTimerRef.current) {
        clearTimeout(popTimerRef.current);
      }
      popOpacity.value = withTiming(0, { duration: 200 });
      setPopActive(false);

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setRound((r) => r + 1);
          scheduleNextPop();
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Alert!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, popActive, popX, popY, popOpacity, scheduleNextPop]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'surprise-pop',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['alertness', 'surprise-response', 'vigilance'],
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
      scheduleNextPop();
      speakTTS('Watch for surprise pops!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, scheduleNextPop]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (popTimerRef.current) {
        clearTimeout(popTimerRef.current);
      }
    };
  }, []);

  const popStyle = useAnimatedStyle(() => ({
    left: popX.value - POP_SIZE / 2,
    top: popY.value - POP_SIZE / 2,
    opacity: popOpacity.value,
    transform: [{ scale: popScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Surprise Pop"
        emoji="💥"
        description="Tap objects when they pop up randomly! Build alertness."
        skills={['Alertness']}
        suitableFor="Children learning alertness and surprise response"
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
            scheduleNextPop();
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
        <Text style={styles.title}>Surprise Pop</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💥 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Watch for surprise pops!
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
        <Animated.View style={[styles.pop, popStyle]}>
          <Text style={styles.popEmoji}>💥</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Alertness
        </Text>
        <Text style={styles.footerSubtext}>
          Tap objects when they pop up randomly!
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
  pop: {
    position: 'absolute',
    width: POP_SIZE,
    height: POP_SIZE,
    borderRadius: POP_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#D97706',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.8,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  popEmoji: {
    fontSize: 50,
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

export default SurprisePopGame;
