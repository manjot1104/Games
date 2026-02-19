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
const SHAPE_SIZE = 90;
const BOX_SIZE = 140;
const TOLERANCE = 70;

type ShapeType = 'circle' | 'square';

const SHAPES = {
  circle: { emoji: '⭕', color: '#3B82F6', name: 'Circle' },
  square: { emoji: '⬜', color: '#10B981', name: 'Square' },
};

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

const ShapeSortGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [circleInBox, setCircleInBox] = useState(false);
  const [squareInBox, setSquareInBox] = useState(false);

  // Circle object
  const circleX = useSharedValue(SCREEN_WIDTH * 0.25);
  const circleY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const circleScale = useSharedValue(1);
  
  // Square object
  const squareX = useSharedValue(SCREEN_WIDTH * 0.75);
  const squareY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const squareScale = useSharedValue(1);
  
  // Boxes
  const circleBoxX = SCREEN_WIDTH * 0.25;
  const circleBoxY = SCREEN_HEIGHT * 0.7;
  const squareBoxX = SCREEN_WIDTH * 0.75;
  const squareBoxY = SCREEN_HEIGHT * 0.7;

  const resetShapes = useCallback(() => {
    circleX.value = withSpring(SCREEN_WIDTH * 0.25);
    circleY.value = withSpring(SCREEN_HEIGHT * 0.3);
    squareX.value = withSpring(SCREEN_WIDTH * 0.75);
    squareY.value = withSpring(SCREEN_HEIGHT * 0.3);
    setCircleInBox(false);
    setSquareInBox(false);
  }, [circleX, circleY, squareX, squareY]);

  const circlePanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      circleScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      circleX.value = Math.max(SHAPE_SIZE / 2, Math.min(SCREEN_WIDTH - SHAPE_SIZE / 2, e.x));
      circleY.value = Math.max(SHAPE_SIZE / 2, Math.min(SCREEN_HEIGHT - SHAPE_SIZE / 2, e.y));
      
      // Check if in correct box
      const dist = Math.sqrt(
        Math.pow(circleX.value - circleBoxX, 2) + Math.pow(circleY.value - circleBoxY, 2)
      );
      setCircleInBox(dist <= TOLERANCE);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      circleScale.value = withSpring(1);
      checkCompletion();
    });

  const squarePanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      squareScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      squareX.value = Math.max(SHAPE_SIZE / 2, Math.min(SCREEN_WIDTH - SHAPE_SIZE / 2, e.x));
      squareY.value = Math.max(SHAPE_SIZE / 2, Math.min(SCREEN_HEIGHT - SHAPE_SIZE / 2, e.y));
      
      // Check if in correct box
      const dist = Math.sqrt(
        Math.pow(squareX.value - squareBoxX, 2) + Math.pow(squareY.value - squareBoxY, 2)
      );
      setSquareInBox(dist <= TOLERANCE);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      squareScale.value = withSpring(1);
      checkCompletion();
    });

  const checkCompletion = useCallback(() => {
    if (circleInBox && squareInBox) {
      // Both shapes in correct boxes!
      setScore((s) => {
        const newScore = s + 1;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speak('Perfect sorting!');
        
        setTimeout(() => {
          if (newScore >= TOTAL_ROUNDS) {
            endGame(newScore);
          } else {
            setRound((r) => r + 1);
            resetShapes();
          }
        }, 1000);
        
        return newScore;
      });
    }
  }, [circleInBox, squareInBox, resetShapes]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 20;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'shape-sort',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['multitasking', 'simultaneous-dragging', 'sorting', 'categorization'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetShapes();
    }
  }, [showInfo, done, resetShapes]);

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

  const circleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: circleX.value - SHAPE_SIZE / 2 },
      { translateY: circleY.value - SHAPE_SIZE / 2 },
      { scale: circleScale.value },
    ],
  }));

  const squareStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: squareX.value - SHAPE_SIZE / 2 },
      { translateY: squareY.value - SHAPE_SIZE / 2 },
      { scale: squareScale.value },
    ],
  }));

  const circleBoxStyle = useAnimatedStyle(() => ({
    opacity: circleInBox ? 1 : 0.5,
    transform: [{ scale: circleInBox ? 1.1 : 1 }],
  }));

  const squareBoxStyle = useAnimatedStyle(() => ({
    opacity: squareInBox ? 1 : 0.5,
    transform: [{ scale: squareInBox ? 1.1 : 1 }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Shape Sort"
        emoji="📦"
        description="2 shapes → 2 boxes! Multitasking!"
        skills={['Multitasking', 'Simultaneous dragging', 'Sorting']}
        suitableFor="Children learning to sort multiple objects simultaneously"
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
            resetShapes();
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
        <Text style={styles.title}>Shape Sort</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag circle to circle box, square to square box!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Boxes */}
        <Animated.View
          style={[
            styles.box,
            styles.circleBox,
            { left: circleBoxX - BOX_SIZE / 2, top: circleBoxY - BOX_SIZE / 2 },
            circleBoxStyle,
          ]}
        >
          <Text style={styles.boxEmoji}>⭕</Text>
          <Text style={styles.boxLabel}>CIRCLE</Text>
        </Animated.View>
        
        <Animated.View
          style={[
            styles.box,
            styles.squareBox,
            { left: squareBoxX - BOX_SIZE / 2, top: squareBoxY - BOX_SIZE / 2 },
            squareBoxStyle,
          ]}
        >
          <Text style={styles.boxEmoji}>⬜</Text>
          <Text style={styles.boxLabel}>SQUARE</Text>
        </Animated.View>

        {/* Draggable Shapes */}
        <GestureDetector gesture={circlePanGesture}>
          <Animated.View style={[styles.shape, { backgroundColor: SHAPES.circle.color }, circleStyle]}>
            <Text style={styles.shapeEmoji}>{SHAPES.circle.emoji}</Text>
          </Animated.View>
        </GestureDetector>
        
        <GestureDetector gesture={squarePanGesture}>
          <Animated.View style={[styles.shape, { backgroundColor: SHAPES.square.color }, squareStyle]}>
            <Text style={styles.shapeEmoji}>{SHAPES.square.emoji}</Text>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Multitasking • Simultaneous dragging • Sorting
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
  shape: {
    position: 'absolute',
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shapeEmoji: {
    fontSize: 50,
  },
  box: {
    position: 'absolute',
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderStyle: 'dashed',
  },
  circleBox: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  squareBox: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  boxEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  boxLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
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

export default ShapeSortGame;
