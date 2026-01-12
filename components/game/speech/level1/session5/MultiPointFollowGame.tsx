import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
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

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTaps?: number;
};

const AVATAR_SIZE = 140;
const OBJECT_SIZE = 120;
const DEFAULT_TTS_RATE = 0.75;

type PointDirection = 'left' | 'right';

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

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

const objects = [
  { emoji: '🎈', name: 'balloon', color: '#EF4444' },
  { emoji: '🧸', name: 'teddy', color: '#F59E0B' },
  { emoji: '🚗', name: 'car', color: '#3B82F6' },
  { emoji: '⚽', name: 'ball', color: '#22C55E' },
  { emoji: '🎨', name: 'crayon', color: '#8B5CF6' },
];

export const MultiPointFollowGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hits, setHits] = useState(0);
  const [round, setRound] = useState(0);
  const [currentSequence, setCurrentSequence] = useState<PointDirection[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPointing, setIsPointing] = useState(false);
  const [leftObjectVisible, setLeftObjectVisible] = useState(false);
  const [rightObjectVisible, setRightObjectVisible] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTaps: number;
    correctTaps: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [leftObjectIndex, setLeftObjectIndex] = useState(0);
  const [rightObjectIndex, setRightObjectIndex] = useState(0);

  const avatarScale = useRef(new Animated.Value(1)).current;
  const armRotation = useRef(new Animated.Value(0)).current;
  const armOpacity = useRef(new Animated.Value(0)).current;
  const pointingLineOpacity = useRef(new Animated.Value(0)).current;
  
  const leftObjectScale = useRef(new Animated.Value(1)).current;
  const leftObjectOpacity = useRef(new Animated.Value(0)).current;
  const leftObjectBounce = useRef(new Animated.Value(1)).current;
  
  const rightObjectScale = useRef(new Animated.Value(1)).current;
  const rightObjectOpacity = useRef(new Animated.Value(0)).current;
  const rightObjectBounce = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    startRound();
    speak('Follow my pointing quickly!');
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
    speak('Amazing! You followed all my pointing perfectly!');

    try {
      const xpAwarded = hits * 10;
      const result = await logGameAndAward({
        type: 'tap',
        correct: hits,
        total: requiredTaps,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['rapid-attention-shifting', 'sustained-joint-engagement', 'communication-flow', 'multi-pointing'],
        meta: {
          gameType: 'multi-point-follow',
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

  const pointAtDirection = useCallback((direction: PointDirection) => {
    setIsPointing(true);
    
    // Calculate the actual angle to the object for proper arm rotation
    const avatarCenterX = SCREEN_WIDTH / 2;
    const avatarCenterY = SCREEN_HEIGHT * 0.3;
    const leftObjectX = SCREEN_WIDTH * 0.15;
    const rightObjectX = SCREEN_WIDTH * 0.85;
    const objectY = SCREEN_HEIGHT * 0.5;
    
    const objectCenterX = direction === 'left' ? leftObjectX : rightObjectX;
    const dx = objectCenterX - avatarCenterX;
    const dy = objectY - avatarCenterY;
    const calculatedAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    Animated.parallel([
      Animated.timing(armRotation, {
        toValue: calculatedAngle,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(armOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pointingLineOpacity, {
        toValue: 0.8,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Start bounce animation for the pointed object
    const bounceAnim = direction === 'left' ? leftObjectBounce : rightObjectBounce;
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: 1.15,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const startRoundRef = useRef<(() => void) | undefined>(undefined);
  
  const executeSequence = useCallback((sequence: PointDirection[], stepIndex: number) => {
    if (stepIndex >= sequence.length) {
      // Sequence complete, wait a bit then start next round
      setTimeout(() => {
        setHits((prevHits) => {
          const nextHits = prevHits + sequence.length;
          if (nextHits < requiredTaps) {
            setTimeout(() => {
              startRoundRef.current?.();
            }, 1500);
          }
          return nextHits;
        });
      }, 1000);
      return;
    }

    const direction = sequence[stepIndex];
    setCurrentStep(stepIndex);
    pointAtDirection(direction);

    // After pointing, wait for tap or timeout
    setTimeout(() => {
      if (stepIndex < sequence.length - 1) {
        // Move to next step immediately
        executeSequence(sequence, stepIndex + 1);
      }
    }, 2000);
  }, [requiredTaps, pointAtDirection]);

  const showBothObjects = () => {
    setLeftObjectVisible(true);
    setRightObjectVisible(true);
    
    Animated.parallel([
      Animated.spring(leftObjectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(leftObjectOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(rightObjectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(rightObjectOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const startRound = useCallback(() => {
    setRound((prev) => prev + 1);
    setCurrentStep(0);
    setIsPointing(false);
    setLeftObjectVisible(false);
    setRightObjectVisible(false);
    
    leftObjectScale.setValue(1);
    leftObjectOpacity.setValue(0);
    leftObjectBounce.setValue(1);
    rightObjectScale.setValue(1);
    rightObjectOpacity.setValue(0);
    rightObjectBounce.setValue(1);
    pointingLineOpacity.setValue(0);
    armRotation.setValue(0);
    armOpacity.setValue(0);

    // Create sequence: left -> right (2 taps per round)
    const sequence: PointDirection[] = ['left', 'right'];
    setCurrentSequence(sequence);

    const leftIndex = Math.floor(Math.random() * objects.length);
    const rightIndex = Math.floor(Math.random() * objects.length);
    setLeftObjectIndex(leftIndex);
    setRightObjectIndex(rightIndex);

    // Show both objects first
    setTimeout(() => {
      showBothObjects();
    }, 500);

    // Start pointing sequence
    setTimeout(() => {
      executeSequence(sequence, 0);
    }, 1500);
  }, [executeSequence]);

  // Update ref when startRound changes
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  const handleObjectTap = (direction: PointDirection) => {
    if (!isPointing) return;
    
    const expectedDirection = currentSequence[currentStep];
    if (direction !== expectedDirection) {
      // Wrong direction - shake animation
      const scaleAnim = direction === 'left' ? leftObjectScale : rightObjectScale;
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
      speak('Try the other side!');
      return;
    }

    // Correct tap
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const scaleAnim = direction === 'left' ? leftObjectScale : rightObjectScale;
    const opacityAnim = direction === 'left' ? leftObjectOpacity : rightObjectOpacity;

    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1.5,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0.5,
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
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
    });

    // Show success animation instead of TTS (only on sequence completion)
    // Check if this was the last step
    if (currentStep === currentSequence.length - 1) {
      // Complete sequence - show animation
      setShowRoundSuccess(true);
      
      Animated.parallel([
        Animated.timing(armOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(pointingLineOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(leftObjectOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(rightObjectOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        setShowRoundSuccess(false);
        setHits((prevHits) => {
          const nextHits = prevHits + currentSequence.length;
          setIsPointing(false);
          setLeftObjectVisible(false);
          setRightObjectVisible(false);
          
          if (nextHits < requiredTaps) {
            setTimeout(() => {
              startRoundRef.current?.();
            }, 500);
          }
          return nextHits;
        });
      }, 2500);
      } else {
        // More steps to go - continue sequence
        setTimeout(() => {
          executeSequence(currentSequence, currentStep + 1);
        }, 300);
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
  const leftObj = objects[leftObjectIndex];
  const rightObj = objects[rightObjectIndex];

  // Calculate pointing line properties for current step
  const avatarCenterX = SCREEN_WIDTH / 2;
  const avatarCenterY = SCREEN_HEIGHT * 0.3;
  const leftObjectX = SCREEN_WIDTH * 0.15;
  const rightObjectX = SCREEN_WIDTH * 0.85;
  const objectY = SCREEN_HEIGHT * 0.5;
  
  const getPointingLineProps = (direction: 'left' | 'right') => {
    const objectCenterX = direction === 'left' ? leftObjectX : rightObjectX;
    const objectCenterY = objectY;
    
    const dx = objectCenterX - avatarCenterX;
    const dy = objectCenterY - avatarCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    const avatarRadius = AVATAR_SIZE / 2;
    const startOffsetX = Math.cos(angle * Math.PI / 180) * avatarRadius;
    const startOffsetY = Math.sin(angle * Math.PI / 180) * avatarRadius;
    const lineLength = distance - avatarRadius - OBJECT_SIZE / 2;
    
    return {
      left: avatarCenterX + startOffsetX,
      top: avatarCenterY + startOffsetY,
      width: Math.max(0, lineLength),
      angle,
    };
  };
  
  const lineProps = isPointing && currentSequence.length > 0 
    ? getPointingLineProps(currentSequence[currentStep]) 
    : null;

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
            <Text style={styles.title}>Multi-Point Follow</Text>
            <Text style={styles.subtitle}>
              {isPointing ? `👆 Pointing ${currentSequence[currentStep]}...` : 'Follow my pointing quickly!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          <View style={[
            styles.avatarContainer,
            {
              left: SCREEN_WIDTH / 2 - AVATAR_SIZE / 2,
              top: SCREEN_HEIGHT * 0.3 - AVATAR_SIZE / 2,
            }
          ]}>
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
                <View style={styles.face}>
                  <View style={styles.eyesContainer}>
                    <View style={styles.eye}>
                      <View style={styles.pupil} />
                    </View>
                    <View style={styles.eye}>
                      <View style={styles.pupil} />
                    </View>
                  </View>
                  <View style={styles.smile} />
                </View>
                
                {/* Pointing Arm */}
                {isPointing && (
                  <Animated.View
                    style={[
                      styles.arm,
                      {
                        transform: [
                          { rotate: armRotation.interpolate({
                            inputRange: [-180, 180],
                            outputRange: ['-180deg', '180deg'],
                          })},
                        ],
                        opacity: armOpacity,
                      },
                    ]}
                  >
                    <View style={styles.armLine} />
                    <View style={styles.hand}>
                      <Text style={styles.handEmoji}>👆</Text>
                    </View>
                  </Animated.View>
                )}
              </LinearGradient>
            </Animated.View>
          </View>

          {/* Pointing line */}
          {isPointing && lineProps && (
            <Animated.View
              style={[
                styles.pointingLine,
                {
                  left: lineProps.left,
                  top: lineProps.top,
                  width: lineProps.width,
                  transform: [
                    { rotate: `${lineProps.angle}deg` },
                  ],
                  opacity: pointingLineOpacity,
                },
              ]}
            >
              <View style={styles.pointingLineInner} />
            </Animated.View>
          )}

          {/* Left Object */}
          {leftObjectVisible && (
            <Animated.View
              style={[
                styles.objectContainer,
                styles.leftObject,
                {
                  transform: [
                    { scale: Animated.multiply(leftObjectScale, leftObjectBounce) },
                  ],
                  opacity: leftObjectOpacity,
                },
              ]}
            >
              <Pressable onPress={() => handleObjectTap('left')} hitSlop={30} style={styles.objectPressable}>
                <LinearGradient
                  colors={[leftObj.color + 'CC', leftObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{leftObj.emoji}</Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          )}

          {/* Right Object */}
          {rightObjectVisible && (
            <Animated.View
              style={[
                styles.objectContainer,
                styles.rightObject,
                {
                  transform: [
                    { scale: Animated.multiply(rightObjectScale, rightObjectBounce) },
                  ],
                  opacity: rightObjectOpacity,
                },
              ]}
            >
              <Pressable onPress={() => handleObjectTap('right')} hitSlop={30} style={styles.objectPressable}>
                <LinearGradient
                  colors={[rightObj.color + 'CC', rightObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{rightObj.emoji}</Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          )}

          {!leftObjectVisible && !rightObjectVisible && !isPointing && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Follow my pointing quickly!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            ⚡ Rapid Attention Shifting • 🤝 Sustained Joint Engagement • 💬 Communication Flow
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
    position: 'relative',
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
  arm: {
    position: 'absolute',
    width: 45,
    height: 10,
    backgroundColor: '#3B82F6',
    borderRadius: 5,
    top: AVATAR_SIZE / 2 - 5,
    left: AVATAR_SIZE / 2,
    transformOrigin: 'left center',
  },
  armLine: {
    flex: 1,
    height: 10,
    backgroundColor: '#3B82F6',
    borderRadius: 5,
  },
  hand: {
    position: 'absolute',
    right: -16,
    top: -12,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 17,
  },
  handEmoji: {
    fontSize: 26,
  },
  pointingLine: {
    position: 'absolute',
    height: 6,
    backgroundColor: '#3B82F6',
    borderRadius: 3,
    zIndex: 50,
    elevation: 5,
    transformOrigin: 'left center',
  },
  pointingLineInner: {
    flex: 1,
    height: 6,
    backgroundColor: '#60A5FA',
    borderRadius: 3,
  },
  objectContainer: {
    position: 'absolute',
    zIndex: 200,
    elevation: 15,
  },
  leftObject: {
    left: '15%',
    top: '50%',
    transform: [{ translateX: -OBJECT_SIZE / 2 }, { translateY: -OBJECT_SIZE / 2 }],
  },
  rightObject: {
    right: '15%',
    top: '50%',
    transform: [{ translateX: OBJECT_SIZE / 2 }, { translateY: -OBJECT_SIZE / 2 }],
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
    fontSize: 70,
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

