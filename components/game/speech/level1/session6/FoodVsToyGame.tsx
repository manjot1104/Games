import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTaps?: number;
};

const ITEM_SIZE = 160;
const DEFAULT_TTS_RATE = 0.75;

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

type CategoryPair = {
  left: {
    emoji: string;
    name: string;
    category: 'food' | 'toy';
    color: string[];
  };
  right: {
    emoji: string;
    name: string;
    category: 'food' | 'toy';
    color: string[];
  };
  instruction: 'food' | 'toy';
  instructionText: string;
};

const CATEGORY_PAIRS: CategoryPair[] = [
  {
    left: { emoji: '🍎', name: 'apple', category: 'food', color: ['#EF4444', '#DC2626'] },
    right: { emoji: '🚗', name: 'car', category: 'toy', color: ['#3B82F6', '#2563EB'] },
    instruction: 'food',
    instructionText: 'Tap the food',
  },
  {
    left: { emoji: '🚗', name: 'car', category: 'toy', color: ['#3B82F6', '#2563EB'] },
    right: { emoji: '🍎', name: 'apple', category: 'food', color: ['#EF4444', '#DC2626'] },
    instruction: 'food',
    instructionText: 'Tap the food',
  },
  {
    left: { emoji: '🍌', name: 'banana', category: 'food', color: ['#FBBF24', '#F59E0B'] },
    right: { emoji: '🧸', name: 'teddy', category: 'toy', color: ['#F59E0B', '#D97706'] },
    instruction: 'toy',
    instructionText: 'Tap the toy',
  },
  {
    left: { emoji: '🧸', name: 'teddy', category: 'toy', color: ['#F59E0B', '#D97706'] },
    right: { emoji: '🍌', name: 'banana', category: 'food', color: ['#FBBF24', '#F59E0B'] },
    instruction: 'toy',
    instructionText: 'Tap the toy',
  },
  {
    left: { emoji: '🍎', name: 'apple', category: 'food', color: ['#EF4444', '#DC2626'] },
    right: { emoji: '⚽', name: 'ball', category: 'toy', color: ['#22C55E', '#16A34A'] },
    instruction: 'food',
    instructionText: 'Tap the food',
  },
  {
    left: { emoji: '⚽', name: 'ball', category: 'toy', color: ['#22C55E', '#16A34A'] },
    right: { emoji: '🍎', name: 'apple', category: 'food', color: ['#EF4444', '#DC2626'] },
    instruction: 'food',
    instructionText: 'Tap the food',
  },
  {
    left: { emoji: '🍌', name: 'banana', category: 'food', color: ['#FBBF24', '#F59E0B'] },
    right: { emoji: '🎈', name: 'balloon', category: 'toy', color: ['#F43F5E', '#E11D48'] },
    instruction: 'toy',
    instructionText: 'Tap the toy',
  },
  {
    left: { emoji: '🎈', name: 'balloon', category: 'toy', color: ['#F43F5E', '#E11D48'] },
    right: { emoji: '🍌', name: 'banana', category: 'food', color: ['#FBBF24', '#F59E0B'] },
    instruction: 'toy',
    instructionText: 'Tap the toy',
  },
];

export const FoodVsToyGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hits, setHits] = useState(0);
  const [round, setRound] = useState(0);
  const [currentPairIndex, setCurrentPairIndex] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'instruction' | 'choice' | 'feedback'>('waiting');
  const [selectedSide, setSelectedSide] = useState<'left' | 'right' | null>(null);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTaps: number;
    correctTaps: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const leftScale = useRef(new Animated.Value(1)).current;
  const leftGlow = useRef(new Animated.Value(0.5)).current;
  const rightScale = useRef(new Animated.Value(1)).current;
  const rightGlow = useRef(new Animated.Value(0.5)).current;
  const leftOpacity = useRef(new Animated.Value(0)).current;
  const rightOpacity = useRef(new Animated.Value(0)).current;
  const instructionBadgeScale = useRef(new Animated.Value(0)).current;
  const instructionBadgeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    startRound();
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  useEffect(() => {
    if (hits >= requiredTaps && !gameFinished) {
      finishGame();
    }
  }, [hits, requiredTaps, gameFinished]);

  const finishGame = useCallback(async () => {
    if (gameFinished) return;
    
    const stats = {
      totalTaps: requiredTaps,
      correctTaps: hits,
      accuracy: Math.round((hits / requiredTaps) * 100),
    };
    setFinalStats(stats);
    setGameFinished(true);
    speak('Amazing! You sorted all the categories perfectly!');

    try {
      const xpAwarded = hits * 10;
      const result = await logGameAndAward({
        type: 'tap',
        correct: hits,
        total: requiredTaps,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['category-sorting', 'cognitive-reasoning', 'complex-choice-preparation'],
        meta: {
          gameType: 'food-vs-toy',
          totalTaps: requiredTaps,
          correctTaps: hits,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [hits, requiredTaps, gameFinished, onComplete]);

  const startRound = useCallback(() => {
    setRound((prev) => prev + 1);
    setPhase('waiting');
    setSelectedSide(null);
    
    leftScale.setValue(1);
    rightScale.setValue(1);
    leftOpacity.setValue(0);
    rightOpacity.setValue(0);
    instructionBadgeScale.setValue(0);
    instructionBadgeOpacity.setValue(0);

    const pairIndex = Math.floor(Math.random() * CATEGORY_PAIRS.length);
    setCurrentPairIndex(pairIndex);

    // Show images first
    Animated.parallel([
      Animated.timing(leftOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(rightOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // After images appear, show instruction
      setTimeout(() => {
        showInstruction(pairIndex);
      }, 800);
    });
  }, []);

  const showInstruction = (pairIndex: number) => {
    setPhase('instruction');
    const currentPair = CATEGORY_PAIRS[pairIndex];
    
    // Animate instruction badge
    Animated.parallel([
      Animated.spring(instructionBadgeScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(instructionBadgeOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Speak instruction
    speak(currentPair.instructionText);

    // Enable choice after instruction
    setTimeout(() => {
      setPhase('choice');
    }, 2000);
  };

  const handleTap = (side: 'left' | 'right') => {
    if (phase !== 'choice' || selectedSide !== null) return;

    setSelectedSide(side);
    setPhase('feedback');
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const currentPair = CATEGORY_PAIRS[currentPairIndex];
    const selectedItem = side === 'left' ? currentPair.left : currentPair.right;
    const isCorrect = selectedItem.category === currentPair.instruction;
    const scaleAnim = side === 'left' ? leftScale : rightScale;

    if (isCorrect) {
      // Correct answer - celebration
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.4,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.6,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();

      // Hide instruction badge
      Animated.parallel([
        Animated.timing(instructionBadgeScale, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(instructionBadgeOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);

      // Fade out both images
      Animated.parallel([
        Animated.timing(leftOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(rightOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        setShowRoundSuccess(false);
        const nextHits = hits + 1;
        setHits(nextHits);

        if (nextHits < requiredTaps) {
          setTimeout(() => {
            startRound();
          }, 500);
        }
      }, 2500);
    } else {
      // Wrong answer - shake animation
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Try again!');
      setTimeout(() => {
        setSelectedSide(null);
        setPhase('choice');
      }, 1000);
    }
  };

  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.correctTaps}
        total={finalStats.totalTaps}
        accuracy={accuracyPct}
        xpAwarded={finalStats.correctTaps * 10}
        onContinue={() => {
          clearScheduledSpeech();
          stopAllSpeech();
          cleanupSounds();
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const progressDots = Array.from({ length: requiredTaps }, (_, i) => i < hits);
  const currentPair = CATEGORY_PAIRS[currentPairIndex];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE', '#BAE6FD']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              Speech.stop();
              onBack();
            }}
            style={styles.backButton}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Food vs Toy</Text>
            <Text style={styles.subtitle}>
              {phase === 'instruction' ? '👂 Listen...' : phase === 'choice' ? '👆 Tap it!' : 'Get ready!'}
            </Text>
          </View>
        </View>

        <View style={styles.gameArea}>
          {/* Instruction Badge */}
          {phase === 'instruction' || phase === 'choice' ? (
            <Animated.View
              style={[
                styles.instructionBadge,
                {
                  transform: [{ scale: instructionBadgeScale }],
                  opacity: instructionBadgeOpacity,
                },
              ]}
            >
              <Text style={styles.instructionText}>👆 {currentPair.instructionText}</Text>
            </Animated.View>
          ) : (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👂 Listen for the category!</Text>
            </View>
          )}

          <View style={styles.imagesContainer}>
            {/* Left Image */}
            <Pressable
              onPress={() => handleTap('left')}
              disabled={phase !== 'choice' || selectedSide !== null}
              style={styles.imagePressable}
            >
              <Animated.View
                style={[
                  styles.imageContainer,
                  {
                    transform: [{ scale: leftScale }],
                    opacity: leftOpacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={currentPair.left.color}
                  style={styles.imageGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.imageEmoji}>{currentPair.left.emoji}</Text>
                  <View style={styles.categoryLabel}>
                    <Text style={styles.categoryText}>
                      {currentPair.left.category === 'food' ? '🍽️ Food' : '🧸 Toy'}
                    </Text>
                  </View>
                </LinearGradient>
              </Animated.View>
            </Pressable>

            {/* Right Image */}
            <Pressable
              onPress={() => handleTap('right')}
              disabled={phase !== 'choice' || selectedSide !== null}
              style={styles.imagePressable}
            >
              <Animated.View
                style={[
                  styles.imageContainer,
                  {
                    transform: [{ scale: rightScale }],
                    opacity: rightOpacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={currentPair.right.color}
                  style={styles.imageGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.imageEmoji}>{currentPair.right.emoji}</Text>
                  <View style={styles.categoryLabel}>
                    <Text style={styles.categoryText}>
                      {currentPair.right.category === 'food' ? '🍽️ Food' : '🧸 Toy'}
                    </Text>
                  </View>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🗂️ Category Sorting • 🧠 Cognitive Reasoning • 🎯 Complex Choice Preparation
          </Text>
          <View style={styles.progressRow}>
            {progressDots.map((filled, idx) => (
              <View
                key={idx}
                style={[styles.progressDot, filled && styles.progressDotFilled]}
              />
            ))}
          </View>
          <Text style={styles.progressText}>
            {hits >= requiredTaps ? '🎊 Amazing! You did it! 🎊' : `Round ${round} • Correct: ${hits} / ${requiredTaps}`}
          </Text>
        </View>
      </LinearGradient>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderBottomWidth: 2,
    borderBottomColor: '#3B82F6',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#E0F2FE',
  },
  backText: {
    marginLeft: 6,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 15,
    color: '#475569',
    fontWeight: '600',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  instructionBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 25,
    marginBottom: 40,
    borderWidth: 3,
    borderColor: '#3B82F6',
  },
  instructionText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E40AF',
    textAlign: 'center',
  },
  imagesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  imagePressable: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  imageContainer: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  imageGradient: {
    width: '100%',
    height: '100%',
    borderRadius: ITEM_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    position: 'relative',
  },
  imageEmoji: {
    fontSize: 80,
  },
  categoryLabel: {
    position: 'absolute',
    bottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  footer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 2,
    borderTopColor: '#3B82F6',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  progressDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E2E8F0',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  progressDotFilled: {
    backgroundColor: '#10B981',
    borderColor: '#059669',
    transform: [{ scale: 1.2 }],
  },
  progressText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  completionScroll: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  completionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});


