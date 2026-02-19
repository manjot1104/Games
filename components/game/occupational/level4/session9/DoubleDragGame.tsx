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
const OBJECT_SIZE = 80;
const TARGET_SIZE = 120;
const TOLERANCE = 60;
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const DoubleDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftDragging, setLeftDragging] = useState(false);
  const [rightDragging, setRightDragging] = useState(false);
  const [leftInTarget, setLeftInTarget] = useState(false);
  const [rightInTarget, setRightInTarget] = useState(false);

  // Left object
  const leftX = useSharedValue(SCREEN_WIDTH * 0.2);
  const leftY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const leftScale = useSharedValue(1);
  
  // Right object
  const rightX = useSharedValue(SCREEN_WIDTH * 0.8);
  const rightY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const rightScale = useSharedValue(1);
  
  // Targets
  const leftTargetX = useSharedValue(SCREEN_WIDTH * 0.2);
  const leftTargetY = useSharedValue(SCREEN_HEIGHT * 0.7);
  const rightTargetX = useSharedValue(SCREEN_WIDTH * 0.8);
  const rightTargetY = useSharedValue(SCREEN_HEIGHT * 0.7);

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setLeftDragging(true);
      leftScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      leftX.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_WIDTH - OBJECT_SIZE / 2, e.x));
      leftY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Check if in target
      const dist = Math.sqrt(
        Math.pow(leftX.value - leftTargetX.value, 2) + Math.pow(leftY.value - leftTargetY.value, 2)
      );
      setLeftInTarget(dist <= TOLERANCE);
    })
    .onEnd(() => {
      if (done) return;
      setLeftDragging(false);
      leftScale.value = withSpring(1);
      checkCompletion();
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setRightDragging(true);
      rightScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      rightX.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_WIDTH - OBJECT_SIZE / 2, e.x));
      rightY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Check if in target
      const dist = Math.sqrt(
        Math.pow(rightX.value - rightTargetX.value, 2) + Math.pow(rightY.value - rightTargetY.value, 2)
      );
      setRightInTarget(dist <= TOLERANCE);
    })
    .onEnd(() => {
      if (done) return;
      setRightDragging(false);
      rightScale.value = withSpring(1);
      checkCompletion();
    });

  const checkCompletion = useCallback(() => {
    if (leftInTarget && rightInTarget) {
      // Both objects in targets!
      setScore((s) => {
        const newScore = s + 1;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speak('Perfect! Both objects dragged!');
        
        setTimeout(() => {
          if (newScore >= TOTAL_ROUNDS) {
            endGame(newScore);
          } else {
            setRound((r) => r + 1);
            resetObjects();
          }
        }, 1000);
        
        return newScore;
      });
    }
  }, [leftInTarget, rightInTarget]);

  const resetObjects = useCallback(() => {
    leftX.value = withSpring(SCREEN_WIDTH * 0.2);
    leftY.value = withSpring(SCREEN_HEIGHT * 0.3);
    rightX.value = withSpring(SCREEN_WIDTH * 0.8);
    rightY.value = withSpring(SCREEN_HEIGHT * 0.3);
    setLeftInTarget(false);
    setRightInTarget(false);
  }, [leftX, leftY, rightX, rightY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 20;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'double-drag',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['bilateral-strength', 'simultaneous-dragging', 'coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetObjects();
    }
  }, [showInfo, done, resetObjects]);

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

  const leftObjectStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftX.value - OBJECT_SIZE / 2 },
      { translateY: leftY.value - OBJECT_SIZE / 2 },
      { scale: leftScale.value },
    ],
  }));

  const rightObjectStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightX.value - OBJECT_SIZE / 2 },
      { translateY: rightY.value - OBJECT_SIZE / 2 },
      { scale: rightScale.value },
    ],
  }));

  const leftTargetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftTargetX.value - TARGET_SIZE / 2 },
      { translateY: leftTargetY.value - TARGET_SIZE / 2 },
    ],
    opacity: leftInTarget ? 1 : 0.5,
  }));

  const rightTargetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightTargetX.value - TARGET_SIZE / 2 },
      { translateY: rightTargetY.value - TARGET_SIZE / 2 },
    ],
    opacity: rightInTarget ? 1 : 0.5,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Double Drag"
        emoji="🤲"
        description="Dono haathon se drag! Bilateral strength!"
        skills={['Bilateral strength', 'Simultaneous dragging', 'Coordination']}
        suitableFor="Children learning to drag with both hands simultaneously"
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
            resetObjects();
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
        <Text style={styles.title}>Double Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag both objects to their targets at the same time!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Targets */}
        <Animated.View style={[styles.target, styles.leftTarget, leftTargetStyle]}>
          <Text style={styles.targetEmoji}>🎯</Text>
        </Animated.View>
        <Animated.View style={[styles.target, styles.rightTarget, rightTargetStyle]}>
          <Text style={styles.targetEmoji}>🎯</Text>
        </Animated.View>

        {/* Draggable Objects */}
        <GestureDetector gesture={leftPanGesture}>
          <Animated.View style={[styles.object, styles.leftObject, leftObjectStyle]}>
            <Text style={styles.objectEmoji}>🔵</Text>
          </Animated.View>
        </GestureDetector>
        
        <GestureDetector gesture={rightPanGesture}>
          <Animated.View style={[styles.object, styles.rightObject, rightObjectStyle]}>
            <Text style={styles.objectEmoji}>🔴</Text>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Bilateral strength • Simultaneous dragging • Coordination
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
  object: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  leftObject: {
    borderColor: '#3B82F6',
  },
  rightObject: {
    borderColor: '#EF4444',
  },
  objectEmoji: {
    fontSize: 40,
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderStyle: 'dashed',
  },
  leftTarget: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  rightTarget: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  targetEmoji: {
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
    textAlign: 'center',
  },
});

export default DoubleDragGame;
