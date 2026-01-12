import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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
const OBJECT_SIZE = 80;
const DEFAULT_TTS_RATE = 0.75;

// Speed levels: slow → medium (never too fast)
const SPEED_LEVELS = [
  { duration: 3000, label: 'Slow' },      // Level 0: Very slow
  { duration: 2200, label: 'Medium' },   // Level 1: Slightly faster
  { duration: 1800, label: 'Faster' },    // Level 2: Medium-fast (max speed)
];

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

export const SlowToFastGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 9, // 3 speed levels × 3 taps each
}) => {
  const [hits, setHits] = useState(0);
  const [speedLevel, setSpeedLevel] = useState(0);
  const [missFeedback, setMissFeedback] = useState(false);
  const [showReinforcement, setShowReinforcement] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);

  const position = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 }))
    .current;
  const objectScale = useRef(new Animated.Value(1)).current;
  const objectOpacity = useRef(new Animated.Value(1)).current;
  const motionLoop = useRef<Animated.CompositeAnimation | null>(null);

  const randomPointOnScreen = useCallback(() => {
    // Generate points across the screen, avoiding edges and footer area
    const margin = 60;
    const topMargin = 100; // More space at top
    const bottomMargin = 180; // Avoid footer area
    return {
      x: margin + Math.random() * (SCREEN_WIDTH - margin * 2),
      y: topMargin + Math.random() * (SCREEN_HEIGHT - topMargin - bottomMargin),
    };
  }, []);

  useEffect(() => {
    // Start with object at a random position on screen
    const startPos = randomPointOnScreen();
    position.setValue(startPos);
    startObjectMotion();
    // Speak initial instruction
    speak('Tap the object as it moves!');
    return () => {
      motionLoop.current?.stop();
      clearScheduledSpeech();
    };
  }, [randomPointOnScreen]);

  // Show congratulations when game finishes
  useEffect(() => {
    console.log('🎮 SlowToFastGame: gameFinished effect triggered', { 
      gameFinished, 
      showCongratulations,
      hits,
      requiredTaps 
    });
    if (gameFinished && !showCongratulations) {
      console.log('🎮 SlowToFastGame: ✅ Setting showCongratulations to true');
      setShowCongratulations(true);
    } else if (gameFinished && showCongratulations) {
      console.log('🎮 SlowToFastGame: ✅ Already showing congratulations');
    }
  }, [gameFinished, showCongratulations, hits, requiredTaps]);

  // Update speed when level changes
  useEffect(() => {
    if (motionLoop.current) {
      motionLoop.current.stop();
      startObjectMotion();
    }
  }, [speedLevel, randomPointOnScreen]);

  const startObjectMotion = useCallback(() => {
    motionLoop.current?.stop();
    const start = randomPointOnScreen();
    position.setValue(start);
    setIsMoving(true);

    const currentSpeed = SPEED_LEVELS[Math.min(speedLevel, SPEED_LEVELS.length - 1)];
    const mid = randomPointOnScreen();
    const end = randomPointOnScreen();

    const sequence = Animated.sequence([
      Animated.timing(position, {
        toValue: mid,
        duration: currentSpeed.duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(position, {
        toValue: end,
        duration: currentSpeed.duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
    ]);

    motionLoop.current = Animated.loop(sequence);
    motionLoop.current.start();
  }, [speedLevel, randomPointOnScreen, position]);


  const handleTap = () => {
    // Always count as hit if object is visible and moving
    if (isMoving) {
      onHit();
    }
  };

  const onHit = () => {
    if (!isMoving) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIsMoving(false);
    motionLoop.current?.stop();

    // Pop animation
    Animated.parallel([
      Animated.timing(objectScale, {
        toValue: 1.5,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      const nextHits = hits + 1;
      setHits(nextHits);

      // Show success animation on every tap (like CatchTheBouncingStar)
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Speed up after every 3 taps (if not at max speed)
      if (nextHits > 0 && nextHits % 3 === 0) {
        setShowReinforcement(true);
        setTimeout(() => {
          setShowReinforcement(false);
        }, 2500);

        if (speedLevel < SPEED_LEVELS.length - 1) {
          const newSpeedLevel = speedLevel + 1;
          setSpeedLevel(newSpeedLevel);
        }
      }

      if (nextHits >= requiredTaps) {
        console.log('🎮 SlowToFastGame: ✅ GAME COMPLETE!', { nextHits, requiredTaps });
        // Stop animations and set states
        setIsMoving(false);
        motionLoop.current?.stop();
        // Hide animation before finishing game
        setTimeout(() => {
          setShowRoundSuccess(false);
          console.log('🎮 SlowToFastGame: About to set gameFinished to true');
          setGameFinished(true);
          console.log('🎮 SlowToFastGame: ✅ Set gameFinished to true');
        }, 2500);
        return;
      }

      // Respawn after short delay
      setTimeout(() => {
        objectScale.setValue(1);
        objectOpacity.setValue(1);
        setIsMoving(true);
        startObjectMotion();
      }, 600);
    });
  };

  const onMiss = () => {
    setMissFeedback(true);
    setTimeout(() => setMissFeedback(false), 500);
    try {
      Haptics.selectionAsync();
    } catch {}
  };

  const currentSpeed = SPEED_LEVELS[Math.min(speedLevel, SPEED_LEVELS.length - 1)];
  const progressDots = Array.from({ length: Math.ceil(requiredTaps / 3) }, (_, i) => 
    Math.floor(hits / 3) > i
  );

  // Debug logging - log on every render
  console.log('🎮 SlowToFastGame: 🔄 RENDER', {
    showCongratulations,
    gameFinished,
    hits,
    requiredTaps,
    shouldShowCongrats: showCongratulations && gameFinished,
  });

  // Show completion screen when game finishes
  if (gameFinished) {
    const accuracyPct = hits >= requiredTaps ? 100 : Math.round((hits / requiredTaps) * 100);
    const xpAwarded = hits * 10;
    console.log('🎮 SlowToFastGame: 🎉 RENDERING Completion Screen NOW!');
    return (
      <CongratulationsScreen
        message="Super Eyes!"
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
          onBack();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
          <Text style={styles.title}>Slow → Fast Game</Text>
          <Text style={styles.subtitle}>Tap the object as it moves! Speed: {currentSpeed.label}</Text>
        </View>
      </View>

      <View style={styles.playArea}>
        <Animated.View
          style={[
            styles.object,
            {
              width: OBJECT_SIZE,
              height: OBJECT_SIZE,
              borderRadius: OBJECT_SIZE / 2,
              transform: [
                { translateX: Animated.subtract(position.x, OBJECT_SIZE / 2) },
                { translateY: Animated.subtract(position.y, OBJECT_SIZE / 2) },
                { scale: objectScale },
              ],
              opacity: objectOpacity,
            },
          ]}
        >
          <Pressable style={styles.objectPressable} onPress={handleTap} hitSlop={40}>
            <Text style={styles.objectEmoji}>⭐</Text>
          </Pressable>
        </Animated.View>

        {missFeedback && (
          <View style={styles.missBadge}>
            <Text style={styles.missText}>Try again!</Text>
          </View>
        )}

        {showReinforcement && (
          <View style={styles.reinforcementBadge}>
            <Text style={styles.reinforcementText}>Super eyes! ✨</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Speed discrimination • Visual attention duration</Text>
        <View style={styles.progressRow}>
          {progressDots.map((filled, idx) => (
            <View
              key={idx}
              style={[styles.progressDot, filled && styles.progressDotFilled]}
            />
          ))}
        </View>
        <Text style={styles.speedIndicator}>
          Speed Level: {speedLevel + 1} / {SPEED_LEVELS.length} • Taps: {hits} / {requiredTaps}
        </Text>
      </View>

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
    backgroundColor: '#EBF5FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#E0F2FE',
  },
  backText: {
    marginLeft: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerText: {
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#475569',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    overflow: 'visible',
  },
  object: {
    position: 'absolute',
    backgroundColor: 'rgba(251, 191, 36, 0.3)',
    borderWidth: 3,
    borderColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 1000,
  },
  objectPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  objectEmoji: {
    fontSize: 36,
  },
  missBadge: {
    position: 'absolute',
    bottom: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
  },
  missText: {
    color: '#B91C1C',
    fontWeight: '700',
    fontSize: 14,
  },
  reinforcementBadge: {
    position: 'absolute',
    top: '30%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FEF3C7',
    borderWidth: 2,
    borderColor: '#FBBF24',
    zIndex: 999,
    elevation: 8,
  },
  reinforcementText: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 18,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  footerText: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  progressDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E2E8F0',
  },
  progressDotFilled: {
    backgroundColor: '#F59E0B',
  },
  speedIndicator: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
});

