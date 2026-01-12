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
const BUTTON_SIZE = 140;
const DEFAULT_TTS_RATE = 0.75;

type Star = {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
  rotation: Animated.Value;
  color: string;
  emoji: string;
};

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

const STAR_EMOJIS = ['✨', '⭐', '🌟', '💫', '🎆', '🎇', '💖', '💝', '🎊', '🎉'];
const COLORS = [
  { gradient: ['#FF6B6B', '#EE5A6F'], name: 'Red' },
  { gradient: ['#4ECDC4', '#44A08D'], name: 'Teal' },
  { gradient: ['#FFE66D', '#FFD93D'], name: 'Yellow' },
  { gradient: ['#A8E6CF', '#88D8A3'], name: 'Green' },
  { gradient: ['#FF8B94', '#FFAAA5'], name: 'Pink' },
  { gradient: ['#95E1D3', '#F38181'], name: 'Coral' },
  { gradient: ['#AA96DA', '#C5B9E8'], name: 'Purple' },
  { gradient: ['#FCBAD3', '#FFC3E1'], name: 'Rose' },
];

export const TapForMagicGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const [hits, setHits] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [stars, setStars] = useState<Star[]>([]);
  const [currentColor, setCurrentColor] = useState(0);
  const starIdCounter = useRef(0);

  const buttonScale = useRef(new Animated.Value(1)).current;
  const buttonGlow = useRef(new Animated.Value(0.5)).current;
  const buttonRotation = useRef(new Animated.Value(0)).current;
  const backgroundPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    startGlowAnimation();
    speak('Tap to make magic!');
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  const startGlowAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(buttonGlow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(buttonGlow, {
          toValue: 0.5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  const createStarBurst = useCallback(() => {
    const newStars: Star[] = [];
    const numStars = 20;
    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT / 2;

    for (let i = 0; i < numStars; i++) {
      const angle = (i / numStars) * Math.PI * 2;
      const distance = 150 + Math.random() * 100;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;

      newStars.push({
        id: starIdCounter.current++,
        x: new Animated.Value(centerX),
        y: new Animated.Value(centerY),
        scale: new Animated.Value(0),
        opacity: new Animated.Value(1),
        rotation: new Animated.Value(0),
        color: COLORS[Math.floor(Math.random() * COLORS.length)].gradient[0],
        emoji: STAR_EMOJIS[Math.floor(Math.random() * STAR_EMOJIS.length)],
      });
    }

    setStars(newStars);

    // Animate stars bursting out
    newStars.forEach((star, index) => {
      const angle = (index / numStars) * Math.PI * 2;
      const distance = 150 + Math.random() * 100;
      const targetX = centerX + Math.cos(angle) * distance;
      const targetY = centerY + Math.sin(angle) * distance;

      Animated.parallel([
        Animated.timing(star.x, {
          toValue: targetX,
          duration: 800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(star.y, {
          toValue: targetY,
          duration: 800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(star.scale, {
            toValue: 1.5,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(star.scale, {
            toValue: 0,
            duration: 600,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(star.opacity, {
          toValue: 0,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(star.rotation, {
          toValue: 360,
          duration: 800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });

    // Clear stars after animation
    setTimeout(() => {
      setStars([]);
    }, 1000);
  }, []);

  const handleTap = () => {
    if (isAnimating) return;

    setIsAnimating(true);
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}

    // Button press animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(buttonScale, {
          toValue: 0.9,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(buttonRotation, {
          toValue: 360,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(buttonScale, {
          toValue: 1.2,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]),
      Animated.spring(buttonScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Background pulse
    Animated.sequence([
      Animated.timing(backgroundPulse, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(backgroundPulse, {
        toValue: 0,
        duration: 600,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();

    // Create star burst
    createStarBurst();

    // Change color for next tap
    setCurrentColor((prev) => (prev + 1) % COLORS.length);

    const nextHits = hits + 1;
    setHits(nextHits);
    setShowSuccess(true);
    // Show success animation instead of TTS
    setShowRoundSuccess(true);

    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowSuccess(false);
      setIsAnimating(false);
      buttonRotation.setValue(0);
    }, 2500);

    if (nextHits >= requiredTaps) {
      setGameFinished(true);
      setShowRoundSuccess(false);
    }
  };

  const progressDots = Array.from({ length: requiredTaps }, (_, i) => i < hits);
  const currentColorScheme = COLORS[currentColor];

  // Show completion screen with stats when game finishes
  if (gameFinished) {
    const accuracyPct = hits >= requiredTaps ? 100 : Math.round((hits / requiredTaps) * 100);
    const xpAwarded = hits * 10;
    return (
      <CongratulationsScreen
        message="Magical Work!"
        showButtons={true}
        correct={hits}
        total={requiredTaps}
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
      <Animated.View
        style={[
          styles.background,
          {
            backgroundColor: backgroundPulse.interpolate({
              inputRange: [0, 1],
              outputRange: ['#F8FAFC', currentColorScheme.gradient[0] + '40'],
            }),
          },
        ]}
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
            <Text style={styles.title}>Tap for Magic</Text>
            <Text style={styles.subtitle}>Tap the button to make magic happen! ✨</Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Magic Button */}
          <Animated.View
            style={[
              styles.buttonContainer,
              {
                transform: [
                  { scale: buttonScale },
                  {
                    rotate: buttonRotation.interpolate({
                      inputRange: [0, 360],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable onPress={handleTap} hitSlop={40} style={styles.buttonPressable}>
              <LinearGradient
                colors={currentColorScheme.gradient}
                style={[
                  styles.magicButton,
                  {
                    shadowColor: currentColorScheme.gradient[0],
                    shadowOpacity: buttonGlow.interpolate({
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
                <Text style={styles.buttonEmoji}>✨</Text>
                <Text style={styles.buttonText}>TAP</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Star Burst */}
          {stars.map((star) => (
            <Animated.View
              key={star.id}
              style={[
                styles.star,
                {
                  left: star.x,
                  top: star.y,
                  transform: [
                    { scale: star.scale },
                    {
                      rotate: star.rotation.interpolate({
                        inputRange: [0, 360],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                  opacity: star.opacity,
                },
              ]}
            >
              <Text style={styles.starEmoji}>{star.emoji}</Text>
            </Animated.View>
          ))}

          {/* Success Message */}
          {showSuccess && (
            <Animated.View style={styles.successBadge}>
              <Text style={styles.successText}>Wow! You did it! 🎉</Text>
            </Animated.View>
          )}

          {/* Instruction */}
          {hits === 0 && !isAnimating && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Tap the button!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🎯 Cause & Effect • 🚀 Builds Initiation • 👆 Sustained Tapping
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
            {hits >= requiredTaps ? '🎊 Amazing! You did it! 🎊' : `Magic taps: ${hits} / ${requiredTaps}`}
          </Text>
        </View>
      </Animated.View>

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
  background: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
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
  buttonContainer: {
    zIndex: 100,
    elevation: 10,
  },
  buttonPressable: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  },
  magicButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  buttonEmoji: {
    fontSize: 50,
    marginBottom: 4,
  },
  buttonText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  star: {
    position: 'absolute',
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    elevation: 5,
  },
  starEmoji: {
    fontSize: 40,
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
    fontSize: 22,
    letterSpacing: 0.5,
  },
  instructionBadge: {
    position: 'absolute',
    top: '20%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 2,
    borderColor: '#3B82F6',
    zIndex: 200,
    elevation: 10,
  },
  instructionText: {
    color: '#1E40AF',
    fontWeight: '800',
    fontSize: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#E2E8F0',
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

