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
  requiredReveals?: number;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 150;
const CLOUD_SIZE = 200;
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

const HIDDEN_OBJECTS = [
  { emoji: '⚽', name: 'ball', color: ['#EF4444', '#DC2626'], glow: '#FCA5A5' },
  { emoji: '🎈', name: 'balloon', color: ['#3B82F6', '#2563EB'], glow: '#93C5FD' },
  { emoji: '🎁', name: 'gift', color: ['#10B981', '#059669'], glow: '#6EE7B7' },
  { emoji: '🎂', name: 'cake', color: ['#F59E0B', '#D97706'], glow: '#FCD34D' },
  { emoji: '🚗', name: 'car', color: ['#8B5CF6', '#7C3AED'], glow: '#C4B5FD' },
  { emoji: '🐻', name: 'bear', color: ['#EC4899', '#DB2777'], glow: '#FBCFE8' },
  { emoji: '🌟', name: 'star', color: ['#FBBF24', '#F59E0B'], glow: '#FDE68A' },
  { emoji: '🎪', name: 'circus', color: ['#06B6D4', '#0891B2'], glow: '#A7F3D0' },
];

export const TapToRevealGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredReveals = 5,
}) => {
  const [reveals, setReveals] = useState(0);
  const [currentObject, setCurrentObject] = useState(0);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isCovered, setIsCovered] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);

  const cloudScale = useRef(new Animated.Value(1)).current;
  const cloudOpacity = useRef(new Animated.Value(1)).current;
  const cloudY = useRef(new Animated.Value(0)).current;
  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;
  const objectBounce = useRef(new Animated.Value(1)).current;
  const sparkleScale = useRef(new Animated.Value(0)).current;
  const sparkleRotation = useRef(new Animated.Value(0)).current;
  const cloudPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    startCloudPulse();
    speak('Tap to see what\'s hiding!');
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  const startCloudPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(cloudPulse, {
          toValue: 1.05,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(cloudPulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const revealObject = useCallback(() => {
    if (isRevealing) return;
    
    setIsRevealing(true);
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const object = HIDDEN_OBJECTS[currentObject];

    // Cloud "poofs" away with more dramatic effect
    Animated.parallel([
      Animated.sequence([
        Animated.timing(cloudScale, {
          toValue: 1.3,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(cloudY, {
            toValue: -120,
            duration: 600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cloudOpacity, {
            toValue: 0,
            duration: 600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cloudScale, {
            toValue: 0.5,
            duration: 600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    // Object appears with exciting bounce and sparkles
    setTimeout(() => {
      setIsCovered(false);
      
      // Multiple sparkle bursts
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          sparkleScale.setValue(0);
          sparkleRotation.setValue(0);
          Animated.parallel([
            Animated.timing(sparkleScale, {
              toValue: 1.8,
              duration: 500,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(sparkleRotation, {
              toValue: 360,
              duration: 500,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(() => {
            sparkleScale.setValue(0);
          });
        }, i * 200);
      }

      // Object appears with dramatic entrance
      Animated.sequence([
        Animated.parallel([
          Animated.spring(objectScale, {
            toValue: 1.3,
            tension: 40,
            friction: 6,
            useNativeDriver: true,
          }),
          Animated.timing(objectOpacity, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.spring(objectScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();

      // Continuous bounce animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(objectBounce, {
            toValue: 1.12,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(objectBounce, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setShowSuccess(true);
    }, 400);

    const nextReveals = reveals + 1;
    setReveals(nextReveals);

    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowSuccess(false);
      setIsRevealing(false);
    }, 2500);

    if (nextReveals >= requiredReveals) {
      setGameFinished(true);
      setShowRoundSuccess(false);
      return;
    }

    // Cover with new object after delay (builds anticipation)
    setTimeout(() => {
      coverWithNewObject();
    }, 3000);
  }, [isRevealing, currentObject, reveals, requiredReveals]);

  const coverWithNewObject = () => {
    // Reset cloud
    cloudY.setValue(0);
    cloudOpacity.setValue(1);
    cloudScale.setValue(1);

    // Hide object
    objectScale.setValue(0);
    objectOpacity.setValue(0);
    objectBounce.setValue(1);

    // Select new random object
    let newObjectIndex;
    do {
      newObjectIndex = Math.floor(Math.random() * HIDDEN_OBJECTS.length);
    } while (newObjectIndex === currentObject && HIDDEN_OBJECTS.length > 1);
    
    setCurrentObject(newObjectIndex);
    setIsCovered(true);

    speak('Tap to see what\'s hiding!');
  };

  const handleTap = () => {
    if (isCovered) {
      revealObject();
    }
  };

  const progressDots = Array.from({ length: requiredReveals }, (_, i) => i < reveals);
  const object = HIDDEN_OBJECTS[currentObject];

  // Show completion screen with stats when game finishes
  if (gameFinished) {
    const accuracyPct = reveals >= requiredReveals ? 100 : Math.round((reveals / requiredReveals) * 100);
    const xpAwarded = reveals * 10;
    return (
      <CongratulationsScreen
        message="Great Reveals!"
        showButtons={true}
        correct={reveals}
        total={requiredReveals}
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
        colors={['#E0F2FE', '#DBEAFE', '#BFDBFE']}
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
            <Text style={styles.title}>Tap to Reveal</Text>
            <Text style={styles.subtitle}>
              {isCovered ? 'What\'s hiding under the cloud? ☁️' : `It's a ${object.name}! ${object.emoji}`}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Cloud Cover */}
          {isCovered && (
            <Animated.View
              style={[
                styles.cloudContainer,
                {
                  transform: [
                    { translateY: cloudY },
                    { scale: Animated.multiply(cloudScale, cloudPulse) },
                  ],
                  opacity: cloudOpacity,
                },
              ]}
            >
              <Pressable onPress={handleTap} hitSlop={50} style={styles.cloudPressable}>
                <LinearGradient
                  colors={['#FFFFFF', '#F8FAFC', '#E2E8F0']}
                  style={styles.cloud}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.cloudEmoji}>☁️</Text>
                  <Text style={styles.cloudText}>Tap me!</Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          )}

          {/* Hidden Object */}
          {!isCovered && (
            <Animated.View
              style={[
                styles.objectContainer,
                {
                  transform: [
                    { scale: Animated.multiply(objectScale, objectBounce) },
                  ],
                  opacity: objectOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={object.color}
                style={styles.object}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.objectEmoji}>{object.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          )}

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
              <Text style={styles.successText}>Oh! It's a {object.name}! 🎉</Text>
            </View>
          )}

          {/* Instruction */}
          {isCovered && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>
                {reveals === 0 ? '👆 Tap the cloud!' : '👆 Tap again to see more!'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            👆 Repeated Tapping • ⏳ Builds Anticipation • 👁️ Receptive Attention
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
            {reveals >= requiredReveals ? '🎊 Amazing! You did it! 🎊' : `Reveals: ${reveals} / ${requiredReveals}`}
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
    borderBottomColor: '#93C5FD',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#DBEAFE',
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
  cloudContainer: {
    zIndex: 100,
    elevation: 10,
  },
  cloudPressable: {
    width: CLOUD_SIZE,
    height: CLOUD_SIZE,
  },
  cloud: {
    width: CLOUD_SIZE,
    height: CLOUD_SIZE,
    borderRadius: CLOUD_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  cloudEmoji: {
    fontSize: 80,
    marginBottom: 8,
  },
  cloudText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#2563EB',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(59, 130, 246, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  objectContainer: {
    zIndex: 50,
    elevation: 8,
  },
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  objectEmoji: {
    fontSize: 90,
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
    borderTopColor: '#93C5FD',
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
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
    transform: [{ scale: 1.2 }],
  },
  progressText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
});

