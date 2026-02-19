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
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 60;
const TARGET_SIZE = 80;
const TOLERANCE = 60;

const TopLeftToBottomRightGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const objectX = useSharedValue(SCREEN_WIDTH * 0.15);
  const objectY = useSharedValue(SCREEN_HEIGHT * 0.15);
  const objectScale = useSharedValue(1);
  const startX = useSharedValue(SCREEN_WIDTH * 0.15);
  const startY = useSharedValue(SCREEN_HEIGHT * 0.15);
  const endX = useSharedValue(SCREEN_WIDTH * 0.85);
  const endY = useSharedValue(SCREEN_HEIGHT * 0.85);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      objectScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      objectX.value = Math.max(OBJECT_SIZE / 2, Math.min(screenWidth.current - OBJECT_SIZE / 2, newX));
      objectY.value = Math.max(OBJECT_SIZE / 2, Math.min(screenHeight.current - OBJECT_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(objectX.value - endX.value, 2) + Math.pow(objectY.value - endY.value, 2)
      );

      if (distance <= TOLERANCE) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              resetObject();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect diagonal!', 0.9, 'en-US' );
      } else {
        resetObject();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag diagonally from top-left to bottom-right!', 0.8, 'en-US' );
      }
    });

  const resetObject = useCallback(() => {
    objectX.value = withSpring(startX.value);
    objectY.value = withSpring(startY.value);
  }, [objectX, objectY, startX, startY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'top-left-bottom-right',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['midline-crossing', 'reading-prep', 'diagonal-drag'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetObject();
      speakTTS('Drag diagonally from top-left to bottom-right!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetObject]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const objectStyle = useAnimatedStyle(() => ({
    left: objectX.value - OBJECT_SIZE / 2,
    top: objectY.value - OBJECT_SIZE / 2,
    transform: [{ scale: objectScale.value }],
  }));

  const targetStyle = useAnimatedStyle(() => ({
    left: endX.value - TARGET_SIZE / 2,
    top: endY.value - TARGET_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Top-Left → Bottom-Right"
        emoji="↘️"
        description="Drag diagonally across the screen from top-left to bottom-right!"
        skills={['Full midline crossing', 'Reading prep skill']}
        suitableFor="Children learning full midline crossing and reading preparation through diagonal dragging"
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
            resetObject();
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
        <Text style={styles.title}>Top-Left → Bottom-Right</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ↘️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag diagonally from top-left to bottom-right!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          startX.value = screenWidth.current * 0.15;
          startY.value = screenHeight.current * 0.15;
          endX.value = screenWidth.current * 0.85;
          endY.value = screenHeight.current * 0.85;
          resetObject();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.target, targetStyle]}>
              <Text style={styles.targetEmoji}>🎯</Text>
              <Text style={styles.targetLabel}>TO</Text>
            </Animated.View>

            <Animated.View style={[styles.object, objectStyle]}>
              <Text style={styles.objectEmoji}>📦</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Full midline crossing • Reading prep
        </Text>
        <Text style={styles.footerSubtext}>
          Drag diagonally across the screen!
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
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#10B981',
    borderWidth: 3,
    borderColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  targetEmoji: {
    fontSize: 40,
  },
  targetLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },
  object: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 30,
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

export default TopLeftToBottomRightGame;
