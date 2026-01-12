import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTaps?: number;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ANIMAL_SIZE = 180;
const DEFAULT_TTS_RATE = 0.75;

type AnimalType = 'dog' | 'cat' | 'bird';
type AnimationType = 'jump' | 'dance' | 'laugh';

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

const ANIMALS = [
  {
    type: 'dog' as AnimalType,
    emoji: '🐕',
    name: 'dog',
    color: ['#F59E0B', '#D97706'],
    glow: '#FCD34D',
    animations: ['jump', 'dance', 'laugh'] as AnimationType[],
  },
  {
    type: 'cat' as AnimalType,
    emoji: '🐱',
    name: 'cat',
    color: ['#8B5CF6', '#7C3AED'],
    glow: '#C4B5FD',
    animations: ['jump', 'dance', 'laugh'] as AnimationType[],
  },
  {
    type: 'bird' as AnimalType,
    emoji: '🐦',
    name: 'bird',
    color: ['#3B82F6', '#2563EB'],
    glow: '#93C5FD',
    animations: ['jump', 'dance', 'laugh'] as AnimationType[],
  },
];

// Define 6 rounds with specific animal and animation
const ROUNDS = [
  { animalIndex: 0, animation: 'jump' as AnimationType },   // Round 1: Dog jump
  { animalIndex: 0, animation: 'dance' as AnimationType },  // Round 2: Dog dance
  { animalIndex: 0, animation: 'laugh' as AnimationType }, // Round 3: Dog laugh
  { animalIndex: 1, animation: 'jump' as AnimationType },  // Round 4: Cat jump
  { animalIndex: 1, animation: 'dance' as AnimationType }, // Round 5: Cat dance
  { animalIndex: 2, animation: 'jump' as AnimationType },  // Round 6: Bird jump
];

const TOTAL_ROUNDS = 6;

export const TapToAnimateGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const [currentRound, setCurrentRound] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [roundComplete, setRoundComplete] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);

  const animalScale = useRef(new Animated.Value(1)).current;
  const animalY = useRef(new Animated.Value(0)).current;
  const animalRotation = useRef(new Animated.Value(0)).current;
  const animalBounce = useRef(new Animated.Value(1)).current;
  const animalGlow = useRef(new Animated.Value(0.5)).current;
  const sparkleScale = useRef(new Animated.Value(0)).current;
  const sparkleRotation = useRef(new Animated.Value(0)).current;

  const currentRoundData = ROUNDS[currentRound];
  const currentAnimal = ANIMALS[currentRoundData.animalIndex];
  const currentAnimation = currentRoundData.animation;

  useEffect(() => {
    startGlowAnimation();
    // Reset animation values for new round
    animalScale.setValue(1);
    animalY.setValue(0);
    animalRotation.setValue(0);
    animalBounce.setValue(1);
    setIsAnimating(false);
    setRoundComplete(false);
    
    const verb = getAnimationVerb(currentAnimation);
    speak(`Tap to make the ${currentAnimal.name} ${verb}!`);
    return () => {
      clearScheduledSpeech();
    };
  }, [currentRound]);

  const startGlowAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animalGlow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(animalGlow, {
          toValue: 0.5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  const getAnimationVerb = (anim: AnimationType): string => {
    switch (anim) {
      case 'jump': return 'jump';
      case 'dance': return 'dance';
      case 'laugh': return 'laugh';
      default: return 'move';
    }
  };

  const animateAnimal = useCallback((animType: AnimationType) => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Sparkle effect
    sparkleScale.setValue(0);
    sparkleRotation.setValue(0);
    Animated.parallel([
      Animated.timing(sparkleScale, {
        toValue: 1.5,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(sparkleRotation, {
        toValue: 360,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      sparkleScale.setValue(0);
    });

    if (animType === 'jump') {
      // Jump animation
      Animated.sequence([
        Animated.parallel([
          Animated.timing(animalY, {
            toValue: -80,
            duration: 300,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalScale, {
            toValue: 1.2,
            duration: 300,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(animalY, {
            toValue: 0,
            duration: 300,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalScale, {
            toValue: 1,
            duration: 300,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setIsAnimating(false);
      });
    } else if (animType === 'dance') {
      // Dance animation (wiggle and bounce)
      Animated.sequence([
        Animated.parallel([
          Animated.sequence([
            Animated.timing(animalRotation, {
              toValue: -15,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(animalRotation, {
              toValue: 15,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(animalRotation, {
              toValue: -15,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(animalRotation, {
              toValue: 0,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(animalBounce, {
              toValue: 1.15,
              duration: 200,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(animalBounce, {
              toValue: 1,
              duration: 200,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start(() => {
        setIsAnimating(false);
        animalRotation.setValue(0);
      });
    } else if (animType === 'laugh') {
      // Laugh animation (bounce and scale)
      Animated.sequence([
        Animated.parallel([
          Animated.timing(animalScale, {
            toValue: 1.3,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalBounce, {
            toValue: 1.1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(animalScale, {
            toValue: 1,
            duration: 200,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalBounce, {
            toValue: 1,
            duration: 200,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(animalScale, {
            toValue: 1.2,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalBounce, {
            toValue: 1.05,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(animalScale, {
            toValue: 1,
            duration: 150,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animalBounce, {
            toValue: 1,
            duration: 150,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setIsAnimating(false);
      });
    }
  }, [isAnimating]);

  const handleAnimalTap = () => {
    if (isAnimating || roundComplete) return;
    
    animateAnimal(currentAnimation);
    setShowSuccess(true);
    // Show success animation instead of TTS
    setShowRoundSuccess(true);

    setTimeout(() => {
      setShowSuccess(false);
      setShowRoundSuccess(false);
    }, 2500);

    // Mark round as complete after animation finishes (animation takes ~800ms)
    setTimeout(() => {
      setRoundComplete(true);
      
      // Move to next round or complete game
      if (currentRound < TOTAL_ROUNDS - 1) {
        setTimeout(() => {
          setCurrentRound(currentRound + 1);
        }, 2500);
      } else {
        // All rounds complete
        setGameFinished(true);
        setShowRoundSuccess(false);
      }
    }, 2500);
  };

  const progressDots = Array.from({ length: TOTAL_ROUNDS }, (_, i) => i < currentRound || (i === currentRound && roundComplete));

  // Show completion screen with stats when game finishes
  if (gameFinished) {
    const completedRounds = TOTAL_ROUNDS;
    const accuracyPct = 100; // All rounds completed
    const xpAwarded = completedRounds * 10;
    return (
      <CongratulationsScreen
        message="Amazing Animations!"
        showButtons={true}
        correct={completedRounds}
        total={TOTAL_ROUNDS}
        accuracy={accuracyPct}
        xpAwarded={xpAwarded}
        onContinue={() => {
          clearScheduledSpeech();
          Speech.stop();
          onComplete?.();
        }}
        onHome={() => {
          clearScheduledSpeech();
          Speech.stop();
          stopAllSpeech();
          cleanupSounds();
          onBack();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              stopAllSpeech();
              cleanupSounds();
              onBack();
            }}
            style={styles.backButton}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Tap to Animate</Text>
            <Text style={styles.subtitle}>
              Round {currentRound + 1} of {TOTAL_ROUNDS}: Tap to make the {currentAnimal.name} {getAnimationVerb(currentAnimation)}! {currentAnimal.emoji}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Animal Container */}
          <Animated.View
            style={[
              styles.animalContainer,
              {
                transform: [
                  { translateY: animalY },
                  { scale: Animated.multiply(animalScale, animalBounce) },
                  {
                    rotate: animalRotation.interpolate({
                      inputRange: [-15, 15],
                      outputRange: ['-15deg', '15deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable onPress={handleAnimalTap} hitSlop={40} style={styles.animalPressable}>
              <LinearGradient
                colors={currentAnimal.color}
                style={[
                  styles.animalCircle,
                  {
                    shadowColor: currentAnimal.glow,
                    shadowOpacity: animalGlow.interpolate({
                      inputRange: [0.5, 1],
                      outputRange: [0.4, 0.8],
                    }),
                    shadowRadius: 30,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 15,
                  },
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.animalEmoji}>{currentAnimal.emoji}</Text>
                {isAnimating && (
                  <View style={styles.animationLabel}>
                    <Text style={styles.animationText}>
                      {currentAnimation === 'jump' ? 'Jump!' : currentAnimation === 'dance' ? 'Dance!' : 'Haha!'}
                    </Text>
                  </View>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Sparkle Effect */}
          <Animated.View
            style={[
              styles.sparkleContainer,
              {
                transform: [
                  { scale: sparkleScale },
                  {
                    rotate: sparkleRotation.interpolate({
                      inputRange: [0, 360],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
                opacity: sparkleScale.interpolate({
                  inputRange: [0, 1, 1.5],
                  outputRange: [0, 1, 0],
                }),
              },
            ]}
          >
            <Text style={styles.sparkleEmoji}>✨</Text>
          </Animated.View>

          {/* Success Message */}
          {showSuccess && (
            <View style={styles.successBadge}>
              <Text style={styles.successText}>Yay! Look how he moves! 🎉</Text>
            </View>
          )}

          {/* Instruction */}
          {!roundComplete && !isAnimating && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Tap to make the {currentAnimal.name} {getAnimationVerb(currentAnimation)}!</Text>
            </View>
          )}

          {/* Round Complete Message */}
          {roundComplete && currentRound < TOTAL_ROUNDS - 1 && (
            <View style={styles.successBadge}>
              <Text style={styles.successText}>Great! Round {currentRound + 1} complete! 🎉</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🎮 Control & Reward • ❤️ Builds Preference • 👆 Tap to Animate
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
            {currentRound >= TOTAL_ROUNDS - 1 && roundComplete 
              ? '🎊 Amazing! You completed all rounds! 🎊' 
              : `Round ${currentRound + 1} of ${TOTAL_ROUNDS}`}
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#86EFAC',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#DCFCE7',
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
  playArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  animalContainer: {
    zIndex: 100,
    elevation: 10,
  },
  animalPressable: {
    width: ANIMAL_SIZE,
    height: ANIMAL_SIZE,
  },
  animalCircle: {
    width: ANIMAL_SIZE,
    height: ANIMAL_SIZE,
    borderRadius: ANIMAL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  animalEmoji: {
    fontSize: 100,
  },
  animationLabel: {
    position: 'absolute',
    bottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#10B981',
  },
  animationText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#059669',
  },
  sparkleContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
    elevation: 9,
  },
  sparkleEmoji: {
    fontSize: 60,
  },
  successBadge: {
    position: 'absolute',
    top: '35%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    borderWidth: 3,
    borderColor: '#FBBF24',
    zIndex: 999,
    elevation: 8,
  },
  successText: {
    color: '#92400E',
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: 0.5,
  },
  instructionBadge: {
    position: 'absolute',
    top: '20%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 2,
    borderColor: '#10B981',
    zIndex: 200,
    elevation: 10,
  },
  instructionText: {
    color: '#059669',
    fontWeight: '800',
    fontSize: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#86EFAC',
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
    justifyContent: 'center',
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
});

