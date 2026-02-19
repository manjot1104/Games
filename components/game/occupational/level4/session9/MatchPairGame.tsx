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
const OBJECT_SIZE = 100;
const MATCH_AREA_SIZE = 150;
const TOLERANCE = 80;
type ShapeType = 'circle' | 'square' | 'triangle' | 'star';

const SHAPES: { type: ShapeType; emoji: string; color: string }[] = [
  { type: 'circle', emoji: '⭕', color: '#3B82F6' },
  { type: 'square', emoji: '⬜', color: '#10B981' },
  { type: 'triangle', emoji: '🔺', color: '#F59E0B' },
  { type: 'star', emoji: '⭐', color: '#8B5CF6' },
];

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

const MatchPairGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftShape, setLeftShape] = useState<ShapeType>('circle');
  const [rightShape, setRightShape] = useState<ShapeType>('circle');
  const [leftInMatch, setLeftInMatch] = useState(false);
  const [rightInMatch, setRightInMatch] = useState(false);

  // Left object
  const leftX = useSharedValue(SCREEN_WIDTH * 0.2);
  const leftY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const leftScale = useSharedValue(1);
  
  // Right object
  const rightX = useSharedValue(SCREEN_WIDTH * 0.8);
  const rightY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const rightScale = useSharedValue(1);
  
  // Match area (center)
  const matchAreaX = SCREEN_WIDTH * 0.5;
  const matchAreaY = SCREEN_HEIGHT * 0.6;

  const generatePair = useCallback(() => {
    const shuffled = [...SHAPES].sort(() => Math.random() - 0.5);
    setLeftShape(shuffled[0].type);
    setRightShape(shuffled[0].type); // Same shape for matching
    setLeftInMatch(false);
    setRightInMatch(false);
    
    // Reset positions
    leftX.value = withSpring(SCREEN_WIDTH * 0.2);
    leftY.value = withSpring(SCREEN_HEIGHT * 0.3);
    rightX.value = withSpring(SCREEN_WIDTH * 0.8);
    rightY.value = withSpring(SCREEN_HEIGHT * 0.3);
  }, [leftX, leftY, rightX, rightY]);

  const leftPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      leftScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      leftX.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_WIDTH - OBJECT_SIZE / 2, e.x));
      leftY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Check if in match area
      const dist = Math.sqrt(
        Math.pow(leftX.value - matchAreaX, 2) + Math.pow(leftY.value - matchAreaY, 2)
      );
      setLeftInMatch(dist <= TOLERANCE);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      leftScale.value = withSpring(1);
      checkCompletion();
    });

  const rightPanGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      rightScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      rightX.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_WIDTH - OBJECT_SIZE / 2, e.x));
      rightY.value = Math.max(OBJECT_SIZE / 2, Math.min(SCREEN_HEIGHT - OBJECT_SIZE / 2, e.y));
      
      // Check if in match area
      const dist = Math.sqrt(
        Math.pow(rightX.value - matchAreaX, 2) + Math.pow(rightY.value - matchAreaY, 2)
      );
      setRightInMatch(dist <= TOLERANCE);
      checkCompletion();
    })
    .onEnd(() => {
      if (done) return;
      rightScale.value = withSpring(1);
      checkCompletion();
    });

  const checkCompletion = useCallback(() => {
    if (leftInMatch && rightInMatch) {
      // Both objects in match area!
      setScore((s) => {
        const newScore = s + 1;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speak('Perfect match!');
        
        setTimeout(() => {
          if (newScore >= TOTAL_ROUNDS) {
            endGame(newScore);
          } else {
            setRound((r) => r + 1);
            generatePair();
          }
        }, 1000);
        
        return newScore;
      });
    }
  }, [leftInMatch, rightInMatch, generatePair]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 20;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'match-pair',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['coordination', 'simultaneous-dragging', 'matching'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      generatePair();
    }
  }, [showInfo, done, generatePair]);

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

  const matchAreaStyle = useAnimatedStyle(() => ({
    opacity: leftInMatch && rightInMatch ? 1 : 0.5,
    transform: [{ scale: leftInMatch && rightInMatch ? 1.1 : 1 }],
  }));

  const leftShapeData = SHAPES.find(s => s.type === leftShape)!;
  const rightShapeData = SHAPES.find(s => s.type === rightShape)!;

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Match Pair"
        emoji="🤝"
        description="Left-right object same time! Coordination!"
        skills={['Coordination', 'Simultaneous dragging', 'Matching']}
        suitableFor="Children learning to drag matching objects simultaneously"
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
            generatePair();
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
        <Text style={styles.title}>Match Pair</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag both matching objects to the center at the same time!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Match Area */}
        <Animated.View
          style={[
            styles.matchArea,
            { left: matchAreaX - MATCH_AREA_SIZE / 2, top: matchAreaY - MATCH_AREA_SIZE / 2 },
            matchAreaStyle,
          ]}
        >
          <Text style={styles.matchAreaText}>MATCH</Text>
        </Animated.View>

        {/* Draggable Objects */}
        <GestureDetector gesture={leftPanGesture}>
          <Animated.View
            style={[
              styles.object,
              { backgroundColor: leftShapeData.color },
              leftObjectStyle,
            ]}
          >
            <Text style={styles.objectEmoji}>{leftShapeData.emoji}</Text>
          </Animated.View>
        </GestureDetector>
        
        <GestureDetector gesture={rightPanGesture}>
          <Animated.View
            style={[
              styles.object,
              { backgroundColor: rightShapeData.color },
              rightObjectStyle,
            ]}
          >
            <Text style={styles.objectEmoji}>{rightShapeData.emoji}</Text>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Coordination • Simultaneous dragging • Matching
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
  objectEmoji: {
    fontSize: 50,
  },
  matchArea: {
    position: 'absolute',
    width: MATCH_AREA_SIZE,
    height: MATCH_AREA_SIZE,
    borderRadius: MATCH_AREA_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#10B981',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  matchAreaText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10B981',
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

export default MatchPairGame;
