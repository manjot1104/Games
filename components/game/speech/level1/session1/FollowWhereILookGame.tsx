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
const AVATAR_SIZE = 120;
const OBJECT_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;

type LookDirection = 'left' | 'right';

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];
let webSpeechSynthesis: SpeechSynthesis | null = null;
let webUtterance: SpeechSynthesisUtterance | null = null;
let isSpeaking = false;
let speechQueue: Array<{ text: string; rate: number }> = [];
let currentSpeechTimer: ReturnType<typeof setTimeout> | null = null;

// Initialize web speech synthesis
if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
  webSpeechSynthesis = window.speechSynthesis;
}

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  if (currentSpeechTimer) {
    clearTimeout(currentSpeechTimer);
    currentSpeechTimer = null;
  }
  try {
    if (Platform.OS === 'web' && webSpeechSynthesis) {
      webSpeechSynthesis.cancel();
      webUtterance = null;
    } else {
      Speech.stop();
    }
  } catch {}
  isSpeaking = false;
  speechQueue = [];
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  // Add to queue
  speechQueue.push({ text, rate });
  
  // If not currently speaking, start processing queue
  if (!isSpeaking) {
    processSpeechQueue();
  }
}

function processSpeechQueue() {
  if (speechQueue.length === 0) {
    isSpeaking = false;
    return;
  }
  
  const { text, rate } = speechQueue.shift()!;
  isSpeaking = true;
  
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
      Speech.stop();
      Speech.speak(text, { rate });
    }
  } catch (e) {
    console.warn('speak error', e);
    isSpeaking = false;
    // Process next in queue even on error
    setTimeout(() => {
      processSpeechQueue();
    }, 100);
  }
}

export const FollowWhereILookGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const [hits, setHits] = useState(0);
  const [currentDirection, setCurrentDirection] = useState<LookDirection>('left');
  const [objectVisible, setObjectVisible] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [round, setRound] = useState(0);
  const [isLooking, setIsLooking] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);

  const avatarScale = useRef(new Animated.Value(1)).current;
  const avatarEyeX = useRef(new Animated.Value(0)).current;
  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;
  const objectBounce = useRef(new Animated.Value(1)).current;
  const gazeLineOpacity = useRef(new Animated.Value(0)).current;
  const gazeLineScale = useRef(new Animated.Value(0)).current;

  const objects = [
    { emoji: '🍎', name: 'apple', color: '#EF4444' },
    { emoji: '🍌', name: 'banana', color: '#FBBF24' },
    { emoji: '🍊', name: 'orange', color: '#F59E0B' },
    { emoji: '🍓', name: 'strawberry', color: '#EC4899' },
    { emoji: '🍇', name: 'grape', color: '#8B5CF6' },
    { emoji: '🥝', name: 'kiwi', color: '#10B981' },
  ];
  const [currentObject, setCurrentObject] = useState(0);

  useEffect(() => {
    startRound();
    speak('Look where I look! Follow my eyes!');
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  // Show congratulations when game finishes
  useEffect(() => {
    console.log('🎮 FollowWhereILookGame: gameFinished effect triggered', { 
      gameFinished, 
      showCongratulations,
      hits,
      requiredTaps 
    });
    if (gameFinished && !showCongratulations) {
      console.log('🎮 FollowWhereILookGame: ✅ Setting showCongratulations to true');
      setShowCongratulations(true);
    } else if (gameFinished && showCongratulations) {
      console.log('🎮 FollowWhereILookGame: ✅ Already showing congratulations');
    }
  }, [gameFinished, showCongratulations, hits, requiredTaps]);

  const startRound = useCallback(() => {
    setRound((prev) => prev + 1);
    setObjectVisible(false);
    setShowFeedback(false);
    setIsLooking(false);
    
    // Reset animations
    objectScale.setValue(0);
    objectOpacity.setValue(0);
    objectBounce.setValue(1);
    gazeLineOpacity.setValue(0);
    gazeLineScale.setValue(0);
    avatarEyeX.setValue(0);

    // Random direction
    const direction: LookDirection = Math.random() > 0.5 ? 'left' : 'right';
    setCurrentDirection(direction);

    // Random object
    const objectIndex = Math.floor(Math.random() * objects.length);
    setCurrentObject(objectIndex);

    // Sequence: Avatar looks -> Object appears
    setTimeout(() => {
      lookAtDirection(direction, objectIndex);
    }, 500);
  }, [objects.length]);

  const lookAtDirection = (direction: LookDirection, objectIndex: number) => {
    setIsLooking(true);
    
    // Animate eyes looking
    const eyeOffset = direction === 'left' ? -8 : 8;
    Animated.timing(avatarEyeX, {
      toValue: eyeOffset,
      duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    // Show gaze line
    Animated.parallel([
      Animated.timing(gazeLineOpacity, {
        toValue: 0.6,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(gazeLineScale, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();

    const directionText = direction === 'left' ? 'I\'m looking left!' : 'I\'m looking right!';
    speak(directionText);

    // Object appears after speech finishes (estimate: ~2 seconds for direction text at rate 0.75)
    // Calculate delay based on speech duration
    const words = directionText.split(/\s+/).length;
    const speechDuration = (words / 150) * 60 * 1000 / DEFAULT_TTS_RATE; // Adjust for rate
    const delay = Math.max(1500, speechDuration + 500); // At least 1.5s, or speech duration + 500ms buffer
    
    setTimeout(() => {
      showObject(direction, objectIndex);
    }, delay);
  };

  const showObject = (direction: LookDirection, objectIndex: number) => {
    setObjectVisible(true);
    
    // Object appears with bounce
    Animated.parallel([
      Animated.spring(objectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Bounce animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(objectBounce, {
          toValue: 1.1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(objectBounce, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Use the passed objectIndex instead of state
    const objectName = objects[objectIndex].name;
    speak('Tap the ' + objectName + '!');
  };

  const handleObjectTap = () => {
    if (!objectVisible) return;

    setObjectVisible(false);
    setShowFeedback(true);
    setFeedbackMessage('Great job! 🎉');
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Success animation
    Animated.parallel([
      Animated.timing(objectScale, {
        toValue: 1.5,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(avatarScale, {
        toValue: 1.2,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      avatarScale.setValue(1);
    });

    // Show success animation instead of TTS
    setShowRoundSuccess(true);

    const nextHits = hits + 1;
    console.log('🎮 FollowWhereILookGame: handleObjectTap called', { 
      currentHits: hits, 
      nextHits, 
      requiredTaps,
      willComplete: nextHits >= requiredTaps 
    });
    setHits(nextHits);

    if (nextHits >= requiredTaps) {
      console.log('🎮 FollowWhereILookGame: ✅ GAME COMPLETE!', { nextHits, requiredTaps });
      // Stop all animations and set states
      setShowFeedback(false);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);
      console.log('🎮 FollowWhereILookGame: About to set gameFinished to true');
      setGameFinished(true);
      console.log('🎮 FollowWhereILookGame: ✅ Set gameFinished to true');
      // Force immediate state update
      setTimeout(() => {
        console.log('🎮 FollowWhereILookGame: Checking state after timeout', {
          gameFinished: true, // This will be the new value
        });
      }, 0);
      return;
    }

    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowFeedback(false);
      startRound();
    }, 2500);
  };

  const progressDots = Array.from({ length: requiredTaps }, (_, i) => i < hits);
  const currentObj = objects[currentObject];
  const objectX = currentDirection === 'left' ? SCREEN_WIDTH * 0.2 : SCREEN_WIDTH * 0.8;
  const objectY = SCREEN_HEIGHT * 0.5;

  // Debug logging - log on every render
  console.log('🎮 FollowWhereILookGame: 🔄 RENDER', {
    showCongratulations,
    gameFinished,
    hits,
    requiredTaps,
    shouldShowCongrats: showCongratulations && gameFinished,
  });

  // Show completion screen with stats when game finishes
  if (gameFinished) {
    const accuracyPct = hits >= requiredTaps ? 100 : Math.round((hits / requiredTaps) * 100);
    const xpAwarded = hits * 10;
    console.log('🎮 FollowWhereILookGame: 🎉 RENDERING Completion Screen with stats');
    return (
      <CongratulationsScreen
        message="Great Job!"
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
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
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
            <Text style={styles.title}>Follow Where I Look</Text>
            <Text style={styles.subtitle}>
              {isLooking ? `👀 Looking ${currentDirection}...` : 'Watch my eyes!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Avatar in center */}
          <View style={styles.avatarContainer}>
            <Animated.View
              style={[
                styles.avatar,
                {
                  transform: [{ scale: avatarScale }],
                },
              ]}
            >
              <LinearGradient
                colors={['#60A5FA', '#3B82F6']}
                style={styles.avatarGradient}
              >
                {/* Face */}
                <View style={styles.face}>
                  {/* Eyes */}
                  <View style={styles.eyesContainer}>
                    <View style={styles.eye}>
                      <Animated.View
                        style={[
                          styles.eyeball,
                          {
                            transform: [{ translateX: avatarEyeX }],
                          },
                        ]}
                      >
                        <View style={styles.pupil} />
                      </Animated.View>
                    </View>
                    <View style={styles.eye}>
                      <Animated.View
                        style={[
                          styles.eyeball,
                          {
                            transform: [{ translateX: avatarEyeX }],
                          },
                        ]}
                      >
                        <View style={styles.pupil} />
                      </Animated.View>
                    </View>
                  </View>
                  {/* Smile */}
                  <View style={styles.smile} />
                </View>
              </LinearGradient>
            </Animated.View>
          </View>

          {/* Gaze line from avatar to object */}
          {isLooking && (
            <Animated.View
              style={[
                styles.gazeLine,
                {
                  left: SCREEN_WIDTH / 2,
                  top: SCREEN_HEIGHT * 0.35,
                  width: currentDirection === 'left' 
                    ? SCREEN_WIDTH * 0.3 
                    : SCREEN_WIDTH * 0.3,
                  transform: [
                    { 
                      translateX: currentDirection === 'left' 
                        ? -SCREEN_WIDTH * 0.3 
                        : SCREEN_WIDTH * 0.3 
                    },
                    { scaleX: gazeLineScale },
                  ],
                  opacity: gazeLineOpacity,
                },
              ]}
            >
              <View style={styles.gazeLineInner} />
            </Animated.View>
          )}

          {/* Object on left or right side */}
          {objectVisible && (
            <Animated.View
              style={[
                styles.objectContainer,
                {
                  left: objectX - OBJECT_SIZE / 2,
                  top: objectY - OBJECT_SIZE / 2,
                  transform: [
                    { scale: Animated.multiply(objectScale, objectBounce) },
                  ],
                  opacity: objectOpacity,
                },
              ]}
            >
              <Pressable onPress={handleObjectTap} hitSlop={30} style={styles.objectPressable}>
                <LinearGradient
                  colors={[currentObj.color + 'CC', currentObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{currentObj.emoji}</Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          )}

          {/* Feedback Message */}
          {showFeedback && (
            <View style={styles.feedbackBadge}>
              <Text style={styles.feedbackText}>{feedbackMessage}</Text>
            </View>
          )}

          {/* Instruction overlay */}
          {!objectVisible && !isLooking && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👀 Watch where I look!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            👁️ Gaze following • 👀 Eye contact building
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
    borderBottomColor: '#FCD34D',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
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
  avatarContainer: {
    position: 'absolute',
    left: SCREEN_WIDTH / 2 - AVATAR_SIZE / 2,
    top: SCREEN_HEIGHT * 0.35 - AVATAR_SIZE / 2,
    zIndex: 100,
    elevation: 10,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatarGradient: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyesContainer: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 8,
  },
  eye: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  eyeball: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0F172A',
  },
  smile: {
    width: 30,
    height: 15,
    borderBottomWidth: 3,
    borderBottomColor: '#0F172A',
    borderRadius: 15,
    marginTop: 4,
  },
  gazeLine: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 2,
    zIndex: 50,
    elevation: 5,
  },
  gazeLineInner: {
    flex: 1,
    backgroundColor: '#60A5FA',
    borderRadius: 2,
  },
  objectContainer: {
    position: 'absolute',
    zIndex: 200,
    elevation: 15,
  },
  objectPressable: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
  },
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  objectEmoji: {
    fontSize: 60,
  },
  feedbackBadge: {
    position: 'absolute',
    top: '50%',
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
    borderTopColor: '#FCD34D',
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

