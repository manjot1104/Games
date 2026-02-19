import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
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
const TARGET_Y = SCREEN_HEIGHT * 0.7;
const TOLERANCE = 100; // Distance tolerance for balanced pace
const SPEED_TOLERANCE = 20; // Speed difference tolerance

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const BalanceDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [bothAtTarget, setBothAtTarget] = useState(false);

  // Left object
  const leftX = useSharedValue(SCREEN_WIDTH * 0.25);
  const leftY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const leftScale = useSharedValue(1);
  const leftSpeed = useRef(0);
  const leftLastY = useRef(SCREEN_HEIGHT * 0.3);
  const leftLastTime = useRef(Date.now());
  
  // Right object
  const rightX = useSharedValue(SCREEN_WIDTH * 0.75);
  const rightY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const rightScale = useSharedValue(1);
  const rightSpeed = useRef(0);
  const rightLastY = useRef(SCREEN_HEIGHT * 0.3);
  const rightLastTime = useRef(Date.now());

  const resetObjects = useCallback(() => {
    leftX.value = withSpring(SCREEN_WIDTH * 0.25);
    leftY.value = withSpring(SCREEN_HEIGHT * 0.3);
    rightX.value = withSpring(SCREEN_WIDTH * 0.75);
    rightY.value = withSpring(SCREEN_HEIGHT * 0.3);
    leftSpeed.current = 0;
    rightSpeed.current = 0;
    leftLastY.current = SCREEN_HEIGHT * 0.3;
    rightLastY.current = SCREEN_HEIGHT * 0.3;
    leftLastTime.current = Date.now();
    rightLastTime.current = Date.now();
    setBothAtTarget(false);
  }, [leftX, leftY, rightX, rightY]);

  const checkBalance = useCallback(() => {
    // Check if both at target Y
    const leftAtTarget = Math.abs(leftY.value - TARGET_Y) <= TOLERANCE;
    const rightAtTarget = Math.abs(rightY.value - TARGET_Y) <= TOLERANCE;
    
    if (leftAtTarget && rightAtTarget) {
      // Check if speeds are balanced
      const speedDiff = Math.abs(leftSpeed.current - rightSpeed.current);
      if (speedDiff <= SPEED_TOLERANCE) {
        setBothAtTarget(true);
        setScore((s) => {
          const newScore = s + 1;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speak('Perfect balance!');
          
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
    } else {
      setBothAtTarget(false);
    }
  }, [leftY, rightY, resetObjects]);

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      leftScale.value = withSpring(1.2);
      leftLastY.current = leftY.value;
      leftLastTime.current = Date.now();
    })
    .onUpdate((e) => {
      if (done) return;
      leftX.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_WIDTH / 2 - OBJECT_SIZE, e.x));
      leftY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Calculate speed
      const now = Date.now();
      const timeDelta = now - leftLastTime.current;
      if (timeDelta > 0) {
        const yDelta = Math.abs(leftY.value - leftLastY.current);
        leftSpeed.current = yDelta / timeDelta * 1000; // pixels per second
        leftLastY.current = leftY.value;
        leftLastTime.current = now;
      }
      
      checkBalance();
    })
    .onEnd(() => {
      if (done) return;
      leftScale.value = withSpring(1);
      checkBalance();
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      rightScale.value = withSpring(1.2);
      rightLastY.current = rightY.value;
      rightLastTime.current = Date.now();
    })
    .onUpdate((e) => {
      if (done) return;
      rightX.value = Math.max(SCREEN_WIDTH / 2 + OBJECT_SIZE, Math.min(SCREEN_WIDTH - OBJECT_SIZE / 2, e.x));
      rightY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Calculate speed
      const now = Date.now();
      const timeDelta = now - rightLastTime.current;
      if (timeDelta > 0) {
        const yDelta = Math.abs(rightY.value - rightLastY.current);
        rightSpeed.current = yDelta / timeDelta * 1000; // pixels per second
        rightLastY.current = rightY.value;
        rightLastTime.current = now;
      }
      
      checkBalance();
    })
    .onEnd(() => {
      if (done) return;
      rightScale.value = withSpring(1);
      checkBalance();
    });

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 20;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'balance-drag',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['speed-regulation', 'balanced-pace', 'simultaneous-dragging', 'coordination'],
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

  const targetLineStyle = useAnimatedStyle(() => ({
    opacity: bothAtTarget ? 1 : 0.3,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Balance Drag"
        emoji="⚖️"
        description="Objects ko equal pace! Speed regulation!"
        skills={['Speed regulation', 'Balanced pace', 'Simultaneous dragging']}
        suitableFor="Children learning to drag objects at equal pace simultaneously"
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
        <Text style={styles.title}>Balance Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag both objects to the line at equal pace!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Target Line */}
        <Animated.View
          style={[
            styles.targetLine,
            { top: TARGET_Y - 2 },
            targetLineStyle,
          ]}
        >
          <Text style={styles.targetLineText}>TARGET</Text>
        </Animated.View>

        {/* Draggable Objects */}
        <GestureDetector gesture={leftPanGesture}>
          <Animated.View style={[styles.object, styles.leftObject, leftObjectStyle]}>
            <Text style={styles.objectEmoji}>⚖️</Text>
          </Animated.View>
        </GestureDetector>
        
        <GestureDetector gesture={rightPanGesture}>
          <Animated.View style={[styles.object, styles.rightObject, rightObjectStyle]}>
            <Text style={styles.objectEmoji}>⚖️</Text>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Speed regulation • Balanced pace • Simultaneous dragging
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
  targetLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetLineText: {
    position: 'absolute',
    backgroundColor: '#10B981',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: '800',
    top: -20,
    alignSelf: 'center',
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

export default BalanceDragGame;
