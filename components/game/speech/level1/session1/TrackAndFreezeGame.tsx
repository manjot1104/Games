import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTaps?: number;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CAR_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;

type GameState = 'moving' | 'stopped' | 'feedback';

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];
let webSpeechSynthesis: SpeechSynthesis | null = null;
let webUtterance: SpeechSynthesisUtterance | null = null;

// Initialize web speech synthesis
if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
  webSpeechSynthesis = window.speechSynthesis;
}

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    if (Platform.OS === 'web' && webSpeechSynthesis) {
      webSpeechSynthesis.cancel();
      webUtterance = null;
    } else {
      Speech.stop();
    }
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    
    if (Platform.OS === 'web' && webSpeechSynthesis) {
      // Use browser's native SpeechSynthesis API for web
      webUtterance = new SpeechSynthesisUtterance(text);
      // Convert rate: expo-speech uses 0-1, browser uses 0.1-10, default 1
      // Map 0.75 (default) to ~0.75, scale appropriately
      webUtterance.rate = Math.max(0.5, Math.min(2, rate * 1.33)); // Scale to browser range
      webUtterance.pitch = 1;
      webUtterance.volume = 1;
      
      webUtterance.onerror = (e) => {
        console.warn('Web TTS error:', e);
      };
      
      webSpeechSynthesis.speak(webUtterance);
    } else {
      // Use expo-speech for native platforms
      Speech.speak(text, { rate });
    }
  } catch (e) {
    console.warn('speak error', e);
  }
}

export const TrackAndFreezeGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const [gameState, setGameState] = useState<GameState>('moving');
  const [hits, setHits] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [round, setRound] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);

  const carX = useRef(new Animated.Value(SCREEN_WIDTH / 2)).current;
  const carY = useRef(new Animated.Value(SCREEN_HEIGHT / 2)).current;
  const carScale = useRef(new Animated.Value(1)).current;
  const carRotation = useRef(new Animated.Value(0)).current;
  const stopGlow = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const movementAnim = useRef<Animated.CompositeAnimation | null>(null);
  const stopTimer = useRef<NodeJS.Timeout | null>(null);

  const carColors = [
    { gradient: ['#EF4444', '#DC2626'], glow: '#FCA5A5', emoji: '🚗' },
    { gradient: ['#3B82F6', '#2563EB'], glow: '#93C5FD', emoji: '🚙' },
    { gradient: ['#10B981', '#059669'], glow: '#6EE7B7', emoji: '🚕' },
    { gradient: ['#F59E0B', '#D97706'], glow: '#FCD34D', emoji: '🚐' },
    { gradient: ['#8B5CF6', '#7C3AED'], glow: '#C4B5FD', emoji: '🚌' },
  ];
  const [currentCarColor, setCurrentCarColor] = useState(0);

  useEffect(() => {
    startRound();
    speak('Follow the car… it stopped! Tap now!');
    return () => {
      movementAnim.current?.stop();
      if (stopTimer.current) clearTimeout(stopTimer.current);
      clearScheduledSpeech();
    };
  }, []);

  // Show congratulations when game finishes
  useEffect(() => {
    console.log('🎮 TrackAndFreezeGame: gameFinished effect triggered', { 
      gameFinished, 
      showCongratulations,
      hits,
      requiredTaps 
    });
    if (gameFinished && !showCongratulations) {
      console.log('🎮 TrackAndFreezeGame: ✅ Setting showCongratulations to true');
      setShowCongratulations(true);
    } else if (gameFinished && showCongratulations) {
      console.log('🎮 TrackAndFreezeGame: ✅ Already showing congratulations');
    }
  }, [gameFinished, showCongratulations, hits, requiredTaps]);

  const startRound = useCallback(() => {
    setRound((prev) => prev + 1);
    setGameState('moving');
    setShowFeedback(false);
    
    // Random starting position
    const startX = 80 + Math.random() * (SCREEN_WIDTH - 160);
    const startY = 150 + Math.random() * (SCREEN_HEIGHT - 400);
    carX.setValue(startX);
    carY.setValue(startY);

    // Random end position
    const endX = 80 + Math.random() * (SCREEN_WIDTH - 160);
    const endY = 150 + Math.random() * (SCREEN_HEIGHT - 400);

    // Calculate rotation based on direction
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    carRotation.setValue(angle);

    // Move duration: 2-4 seconds
    const moveDuration = 2000 + Math.random() * 2000;

    movementAnim.current = Animated.parallel([
      Animated.timing(carX, {
        toValue: endX,
        duration: moveDuration,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(carY, {
        toValue: endY,
        duration: moveDuration,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]);

    movementAnim.current.start(() => {
      // Car stops!
      stopCar();
    });
  }, [carX, carY, carRotation]);

  const stopCar = () => {
    setGameState('stopped');
    movementAnim.current?.stop();
    
    // Stop glow animation
    stopGlow.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(stopGlow, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(stopGlow, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();

    // Pulse animation to indicate it's ready to tap
    pulseScale.setValue(1);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.15,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    speak('It stopped! Tap now!');

    // Auto-advance if not tapped within 3 seconds
    stopTimer.current = setTimeout(() => {
      handleTimeout();
    }, 3000);
  };

  const handleCarTap = () => {
    if (gameState === 'moving') {
      // Tapped while moving - impulse control violation!
      handleEarlyTap();
    } else if (gameState === 'stopped') {
      // Tapped when stopped - correct!
      handleCorrectTap();
    }
  };

  const handleEarlyTap = () => {
    setEarlyTaps((prev) => prev + 1);
    setShowFeedback(true);
    setFeedbackMessage('Wait! The car is moving! 🛑');
    setGameState('feedback');
    
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}

    // Shake animation
    Animated.sequence([
      Animated.timing(carX, {
        toValue: carX.__getValue() + 10,
        duration: 50,
        useNativeDriver: false,
      }),
      Animated.timing(carX, {
        toValue: carX.__getValue() - 20,
        duration: 50,
        useNativeDriver: false,
      }),
      Animated.timing(carX, {
        toValue: carX.__getValue() + 10,
        duration: 50,
        useNativeDriver: false,
      }),
    ]).start();

    setTimeout(() => {
      setShowFeedback(false);
      setGameState('moving');
    }, 1500);
  };

  const handleCorrectTap = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    
    setHits((prev) => prev + 1);
    setShowFeedback(true);
    setFeedbackMessage('Great job! 🎉');
    setGameState('feedback');
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Success animation
    Animated.parallel([
      Animated.timing(carScale, {
        toValue: 1.3,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(carRotation, {
        toValue: carRotation.__getValue() + 360,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      carScale.setValue(1);
      carRotation.setValue(carRotation.__getValue() % 360);
    });

    // Show success animation instead of TTS
    setShowRoundSuccess(true);

    const nextHits = hits + 1;
    console.log('🎮 TrackAndFreezeGame: handleCorrectTap called', { 
      currentHits: hits, 
      nextHits, 
      requiredTaps,
      willComplete: nextHits >= requiredTaps 
    });
    if (nextHits >= requiredTaps) {
      console.log('🎮 TrackAndFreezeGame: ✅ GAME COMPLETE!', { nextHits, requiredTaps });
      // Stop animations and set states
      if (stopTimer.current) clearTimeout(stopTimer.current);
      movementAnim.current?.stop();
      setShowFeedback(false);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);
      console.log('🎮 TrackAndFreezeGame: About to set gameFinished to true');
      setGameFinished(true);
      console.log('🎮 TrackAndFreezeGame: ✅ Set gameFinished to true');
      return;
    }

    // Change car color
    setCurrentCarColor((prev) => (prev + 1) % carColors.length);

    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowFeedback(false);
      startRound();
    }, 2500);
  };

  const handleTimeout = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    setShowFeedback(true);
    setFeedbackMessage('Too slow! Try again! ⏰');
    setGameState('feedback');
    
    setTimeout(() => {
      setShowFeedback(false);
      startRound();
    }, 1500);
  };

  const currentCar = carColors[currentCarColor];
  const progressDots = Array.from({ length: requiredTaps }, (_, i) => i < hits);

  // Debug logging - log on every render
  console.log('🎮 TrackAndFreezeGame: 🔄 RENDER', {
    showCongratulations,
    gameFinished,
    hits,
    requiredTaps,
    shouldShowCongrats: showCongratulations && gameFinished,
  });

  // Show congratulations screen when game finishes
  if (showCongratulations && gameFinished) {
    console.log('🎮 TrackAndFreezeGame: 🎉 RENDERING CongratulationsScreen NOW!');
    return (
      <CongratulationsScreen
        message="Excellent Control!"
        showButtons={true}
        onContinue={() => {
          setShowCongratulations(false);
          setTimeout(() => {
            onComplete?.();
            setTimeout(() => onBack(), 500);
          }, 500);
        }}
        onHome={() => {
          clearScheduledSpeech();
          Speech.stop();
          onBack();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE', '#DBEAFE']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Track & Freeze</Text>
            <Text style={styles.subtitle}>
              {gameState === 'moving' ? '🚗 Car is moving...' : '🛑 Car stopped! Tap now!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Road background effect */}
          <View style={styles.roadLines}>
            {[...Array(5)].map((_, i) => (
              <View key={i} style={[styles.roadLine, { top: `${20 + i * 20}%` }]} />
            ))}
          </View>

          {/* Moving/Stopped Car */}
          <Animated.View
            style={[
              styles.carContainer,
              {
                transform: [
                  { translateX: Animated.subtract(carX, CAR_SIZE / 2) },
                  { translateY: Animated.subtract(carY, CAR_SIZE / 2) },
                  { scale: carScale },
                  {
                    rotate: carRotation.interpolate({
                      inputRange: [0, 360],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable onPress={handleCarTap} hitSlop={20} style={styles.carPressable}>
              <LinearGradient
                colors={currentCar.gradient}
                style={[
                  styles.car,
                  gameState === 'stopped' && {
                    shadowColor: currentCar.glow,
                    shadowOpacity: stopGlow.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.3, 0.8],
                    }),
                    shadowRadius: 20,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 10,
                  },
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Animated.View
                  style={[
                    styles.carInner,
                    {
                      transform: [{ scale: gameState === 'stopped' ? pulseScale : 1 }],
                    },
                  ]}
                >
                  <Text style={styles.carEmoji}>{currentCar.emoji}</Text>
                  {gameState === 'stopped' && (
                    <View style={styles.stopIndicator}>
                      <Text style={styles.stopText}>STOP</Text>
                    </View>
                  )}
                </Animated.View>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Feedback Messages */}
          {showFeedback && (
            <View style={styles.feedbackBadge}>
              <Text style={styles.feedbackText}>{feedbackMessage}</Text>
            </View>
          )}

          {/* Instruction overlay when moving */}
          {gameState === 'moving' && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👀 Watch the car move...</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🧠 Impulse control • 👁️ Visual attention • 🛑 Response inhibition
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Correct</Text>
              <Text style={styles.statValue}>✅ {hits}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Early Taps</Text>
              <Text style={[styles.statValue, styles.statValueWarning]}>⚠️ {earlyTaps}</Text>
            </View>
          </View>
          <View style={styles.progressRow}>
            {progressDots.map((filled, idx) => (
              <View
                key={idx}
                style={[styles.progressDot, filled && styles.progressDotFilled]}
              />
            ))}
          </View>
          <Text style={styles.progressText}>
            {hits >= requiredTaps ? '🎊 Amazing! You did it! 🎊' : `Round ${round} • Taps: ${hits} / ${requiredTaps}`}
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
    borderBottomColor: '#BFDBFE',
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
    overflow: 'visible',
  },
  roadLines: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  roadLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(156, 163, 175, 0.3)',
    borderStyle: 'dashed',
  },
  carContainer: {
    position: 'absolute',
    zIndex: 1000,
    elevation: 10,
  },
  carPressable: {
    width: CAR_SIZE,
    height: CAR_SIZE,
  },
  car: {
    width: CAR_SIZE,
    height: CAR_SIZE,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  carInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  carEmoji: {
    fontSize: 60,
  },
  stopIndicator: {
    position: 'absolute',
    bottom: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  stopText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#EF4444',
    letterSpacing: 1,
  },
  feedbackBadge: {
    position: 'absolute',
    top: '40%',
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
  feedbackText: {
    color: '#92400E',
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: 0.5,
  },
  instructionBadge: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  instructionText: {
    color: '#1E40AF',
    fontWeight: '800',
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#BFDBFE',
  },
  footerText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10B981',
  },
  statValueWarning: {
    color: '#F59E0B',
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

