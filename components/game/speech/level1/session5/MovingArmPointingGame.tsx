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

export const MovingArmPointingGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hits, setHits] = useState(0);
  const [currentDirection, setCurrentDirection] = useState<PointDirection>('left');
  const [objectVisible, setObjectVisible] = useState(true);
  const [round, setRound] = useState(0);
  const [isPointing, setIsPointing] = useState(false);
  const [armRaised, setArmRaised] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTaps: number;
    correctTaps: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const avatarScale = useRef(new Animated.Value(1)).current;
  const armRotation = useRef(new Animated.Value(0)).current;
  const armOpacity = useRef(new Animated.Value(0)).current;
  const armRaiseY = useRef(new Animated.Value(0)).current;
  const objectScale = useRef(new Animated.Value(1)).current;
  const objectBounce = useRef(new Animated.Value(1)).current;
  const pointingLineOpacity = useRef(new Animated.Value(0)).current;

  const [currentObject, setCurrentObject] = useState(0);

  useEffect(() => {
    startRound();
    speak('Watch my arm move!');
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
    speak('Amazing! You tracked my moving arm perfectly!');

    try {
      const xpAwarded = hits * 10;
      const result = await logGameAndAward({
        type: 'tap',
        correct: hits,
        total: requiredTaps,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['social-motion-detection', 'visual-tracking', 'gesture-integration', 'dynamic-pointing'],
        meta: {
          gameType: 'moving-arm-pointing',
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
    setObjectVisible(true);
    setIsPointing(false);
    setArmRaised(false);
    
    objectScale.setValue(1);
    objectBounce.setValue(1);
    pointingLineOpacity.setValue(0);
    armRotation.setValue(0);
    armOpacity.setValue(0);
    armRaiseY.setValue(0);

    const direction: PointDirection = Math.random() > 0.5 ? 'left' : 'right';
    setCurrentDirection(direction);

    const objectIndex = Math.floor(Math.random() * objects.length);
    setCurrentObject(objectIndex);

    setTimeout(() => {
      raiseArmAndPoint(direction);
    }, 800);
  }, []);

  const raiseArmAndPoint = (direction: PointDirection) => {
    // Step 1: Raise arm slowly
    setArmRaised(true);
    
    // Calculate the actual angle to the object for proper arm rotation
    const avatarCenterX = SCREEN_WIDTH / 2;
    const avatarCenterY = SCREEN_HEIGHT * 0.3;
    const objectCenterX = direction === 'left' ? SCREEN_WIDTH * 0.15 : SCREEN_WIDTH * 0.85;
    const objectCenterY = SCREEN_HEIGHT * 0.5;
    
    const dx = objectCenterX - avatarCenterX;
    const dy = objectCenterY - avatarCenterY;
    const calculatedAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    Animated.sequence([
      Animated.timing(armRaiseY, {
        toValue: -30,
        duration: 800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(armOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Step 2: Point to direction
      setIsPointing(true);
      
      Animated.parallel([
        Animated.timing(armRotation, {
          toValue: calculatedAngle,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pointingLineOpacity, {
          toValue: 0.8,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    });

    // Start object bounce animation when pointing starts
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(objectBounce, {
            toValue: 1.15,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(objectBounce, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }, 1400);
  };

  const handleObjectTap = () => {
    if (!objectVisible || !isPointing) return;

    setObjectVisible(false);
    setIsPointing(false);
    setArmRaised(false);
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    Animated.parallel([
      Animated.timing(objectScale, {
        toValue: 1.5,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(armOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(armRaiseY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(pointingLineOpacity, {
        toValue: 0,
        duration: 200,
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
  const currentObj = objects[currentObject];
  const objectX = currentDirection === 'left' ? SCREEN_WIDTH * 0.15 : SCREEN_WIDTH * 0.85;
  const objectY = SCREEN_HEIGHT * 0.5;

  // Calculate pointing line properties
  const avatarCenterX = SCREEN_WIDTH / 2;
  const avatarCenterY = SCREEN_HEIGHT * 0.3;
  const objectCenterX = objectX;
  const objectCenterY = objectY;
  
  const dx = objectCenterX - avatarCenterX;
  const dy = objectCenterY - avatarCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  
  // Start from avatar edge
  const avatarRadius = AVATAR_SIZE / 2;
  const startOffsetX = Math.cos(angle * Math.PI / 180) * avatarRadius;
  const startOffsetY = Math.sin(angle * Math.PI / 180) * avatarRadius;
  
  // Line length (distance minus avatar and object radii)
  const lineLength = distance - avatarRadius - OBJECT_SIZE / 2;

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
            <Text style={styles.title}>Moving Arm Pointing</Text>
            <Text style={styles.subtitle}>
              {armRaised && !isPointing ? '👆 Raising arm...' : isPointing ? `👆 Pointing ${currentDirection}...` : 'Watch my arm move!'}
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
                
                {/* Moving Pointing Arm */}
                {(armRaised || isPointing) && (
                  <Animated.View
                    style={[
                      styles.arm,
                      {
                        transform: [
                          { translateY: armRaiseY },
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
          {isPointing && (
            <Animated.View
              style={[
                styles.pointingLine,
                {
                  left: avatarCenterX + startOffsetX,
                  top: avatarCenterY + startOffsetY,
                  width: Math.max(0, lineLength),
                  transform: [
                    { rotate: `${angle}deg` },
                  ],
                  opacity: pointingLineOpacity,
                },
              ]}
            >
              <View style={styles.pointingLineInner} />
            </Animated.View>
          )}

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

          {!objectVisible && !isPointing && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Follow my moving arm!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            👁️ Social Motion Detection • 🎯 Visual Tracking • 🤝 Gesture Integration
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
    borderTopColor: '#3B82F6',
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

