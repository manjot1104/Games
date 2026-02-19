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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HANDLE_SIZE = 100;
const ROPE_LENGTH = SCREEN_WIDTH * 0.4;
const PULL_THRESHOLD = 150; // Distance to pull
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const RopePullGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftPulled, setLeftPulled] = useState(false);
  const [rightPulled, setRightPulled] = useState(false);

  // Left handle
  const leftX = useSharedValue(SCREEN_WIDTH * 0.2);
  const leftY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const leftScale = useSharedValue(1);
  const leftStartX = SCREEN_WIDTH * 0.2;
  const leftStartY = SCREEN_HEIGHT * 0.5;
  
  // Right handle
  const rightX = useSharedValue(SCREEN_WIDTH * 0.8);
  const rightY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const rightScale = useSharedValue(1);
  const rightStartX = SCREEN_WIDTH * 0.8;
  const rightStartY = SCREEN_HEIGHT * 0.5;

  const resetHandles = useCallback(() => {
    leftX.value = withSpring(leftStartX);
    leftY.value = withSpring(leftStartY);
    rightX.value = withSpring(rightStartX);
    rightY.value = withSpring(rightStartY);
    setLeftPulled(false);
    setRightPulled(false);
  }, [leftX, leftY, rightX, rightY]);

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      leftScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      leftX.value = Math.max(0, Math.min(SCREEN_WIDTH / 2 - HANDLE_SIZE, e.x));
      leftY.value = Math.max(SCREEN_HEIGHT * 0.3, Math.min(SCREEN_HEIGHT * 0.7, e.y));
      
      // Check if pulled far enough (moving left/up)
      const dist = Math.sqrt(
        Math.pow(leftX.value - leftStartX, 2) + Math.pow(leftY.value - leftStartY, 2)
      );
      setLeftPulled(dist >= PULL_THRESHOLD);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      leftScale.value = withSpring(1);
      if (!leftPulled) {
        leftX.value = withSpring(leftStartX);
        leftY.value = withSpring(leftStartY);
      }
      checkCompletion();
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      rightScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      rightX.value = Math.max(SCREEN_WIDTH / 2 + HANDLE_SIZE, Math.min(SCREEN_WIDTH, e.x));
      rightY.value = Math.max(SCREEN_HEIGHT * 0.3, Math.min(SCREEN_HEIGHT * 0.7, e.y));
      
      // Check if pulled far enough (moving right/up)
      const dist = Math.sqrt(
        Math.pow(rightX.value - rightStartX, 2) + Math.pow(rightY.value - rightStartY, 2)
      );
      setRightPulled(dist >= PULL_THRESHOLD);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      rightScale.value = withSpring(1);
      if (!rightPulled) {
        rightX.value = withSpring(rightStartX);
        rightY.value = withSpring(rightStartY);
      }
      checkCompletion();
    });

  const checkCompletion = useCallback(() => {
    if (leftPulled && rightPulled) {
      // Both sides pulled!
      setScore((s) => {
        const newScore = s + 1;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speak('Perfect pull!');
        
        setTimeout(() => {
          if (newScore >= TOTAL_ROUNDS) {
            endGame(newScore);
          } else {
            setRound((r) => r + 1);
            resetHandles();
          }
        }, 1000);
        
        return newScore;
      });
    }
  }, [leftPulled, rightPulled, resetHandles]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 20;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'rope-pull',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['upper-body-integration', 'simultaneous-pulling', 'bilateral-coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetHandles();
    }
  }, [showInfo, done, resetHandles]);

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

  const leftHandleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftX.value - HANDLE_SIZE / 2 },
      { translateY: leftY.value - HANDLE_SIZE / 2 },
      { scale: leftScale.value },
    ],
  }));

  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightX.value - HANDLE_SIZE / 2 },
      { translateY: rightY.value - HANDLE_SIZE / 2 },
      { scale: rightScale.value },
    ],
  }));

  const ropeStyle = useAnimatedStyle(() => {
    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT * 0.5;
    const leftDist = Math.sqrt(
      Math.pow(leftX.value - centerX, 2) + Math.pow(leftY.value - centerY, 2)
    );
    const rightDist = Math.sqrt(
      Math.pow(rightX.value - centerX, 2) + Math.pow(rightY.value - centerY, 2)
    );
    const tension = (leftDist + rightDist) / (ROPE_LENGTH * 2);
    
    return {
      opacity: 0.3 + tension * 0.7,
      transform: [{ scaleY: 1 + tension * 0.2 }],
    };
  });

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Rope Pull"
        emoji="🪢"
        description="Dono sides rope pull! Upper body integration!"
        skills={['Upper body integration', 'Simultaneous pulling', 'Bilateral coordination']}
        suitableFor="Children learning to pull with both hands simultaneously"
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
            resetHandles();
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
        <Text style={styles.title}>Rope Pull</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Pull both handles away from center at the same time!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Rope */}
        <Animated.View
          style={[
            styles.rope,
            {
              left: SCREEN_WIDTH / 2 - 5,
              top: SCREEN_HEIGHT * 0.5 - ROPE_LENGTH / 2,
            },
            ropeStyle,
          ]}
        />

        {/* Handles */}
        <GestureDetector gesture={leftPanGesture}>
          <Animated.View style={[styles.handle, styles.leftHandle, leftHandleStyle]}>
            <Text style={styles.handleEmoji}>👈</Text>
            {leftPulled && <Text style={styles.checkMark}>✓</Text>}
          </Animated.View>
        </GestureDetector>
        
        <GestureDetector gesture={rightPanGesture}>
          <Animated.View style={[styles.handle, styles.rightHandle, rightHandleStyle]}>
            <Text style={styles.handleEmoji}>👉</Text>
            {rightPulled && <Text style={styles.checkMark}>✓</Text>}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Upper body integration • Simultaneous pulling • Bilateral coordination
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
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  rope: {
    position: 'absolute',
    width: 10,
    height: ROPE_LENGTH,
    backgroundColor: '#8B4513',
    borderRadius: 5,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  leftHandle: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHandle: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handleEmoji: {
    fontSize: 50,
  },
  checkMark: {
    position: 'absolute',
    top: 5,
    right: 5,
    fontSize: 24,
    color: '#10B981',
    fontWeight: '900',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default RopePullGame;
