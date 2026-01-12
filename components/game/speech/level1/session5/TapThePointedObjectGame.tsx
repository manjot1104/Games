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
const OBJECT_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;

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

const objectSets = [
  [
    { emoji: '⚽', name: 'ball', color: '#22C55E', position: 'left' },
    { emoji: '🍎', name: 'apple', color: '#EF4444', position: 'center' },
    { emoji: '🚗', name: 'car', color: '#3B82F6', position: 'right' },
  ],
  [
    { emoji: '🎈', name: 'balloon', color: '#F43F5E', position: 'left' },
    { emoji: '🧸', name: 'teddy', color: '#F59E0B', position: 'center' },
    { emoji: '⭐', name: 'star', color: '#FCD34D', position: 'right' },
  ],
  [
    { emoji: '🐶', name: 'dog', color: '#8B5CF6', position: 'left' },
    { emoji: '🐱', name: 'cat', color: '#EC4899', position: 'center' },
    { emoji: '🐰', name: 'bunny', color: '#F472B6', position: 'right' },
  ],
];

type ObjectPosition = 'left' | 'center' | 'right';

export const TapThePointedObjectGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hits, setHits] = useState(0);
  const [round, setRound] = useState(0);
  const [isPointing, setIsPointing] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTaps: number;
    correctTaps: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [pointedPosition, setPointedPosition] = useState<ObjectPosition>('left');
  const [selectedPosition, setSelectedPosition] = useState<ObjectPosition | null>(null);

  const avatarScale = useRef(new Animated.Value(1)).current;
  const armRotation = useRef(new Animated.Value(0)).current;
  const armOpacity = useRef(new Animated.Value(0)).current;
  const pointingLineOpacity = useRef(new Animated.Value(0)).current;
  const objectsScale = useRef(new Animated.Value(0)).current;
  const objectsOpacity = useRef(new Animated.Value(0)).current;
  
  const leftObjectScale = useRef(new Animated.Value(1)).current;
  const centerObjectScale = useRef(new Animated.Value(1)).current;
  const rightObjectScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    startRound();
    speak('I\'m pointing to something… can you find it?');
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
    speak('Amazing! You found all the pointed objects!');

    try {
      const xpAwarded = hits * 10;
      const result = await logGameAndAward({
        type: 'tap',
        correct: hits,
        total: requiredTaps,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['discrimination', 'social-interpretation', 'aac-preparation', 'pointing'],
        meta: {
          gameType: 'tap-the-pointed-object',
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
    setIsPointing(false);
    setSelectedPosition(null);
    
    objectsScale.setValue(0);
    objectsOpacity.setValue(0);
    pointingLineOpacity.setValue(0);
    armRotation.setValue(0);
    armOpacity.setValue(0);
    leftObjectScale.setValue(1);
    centerObjectScale.setValue(1);
    rightObjectScale.setValue(1);

    const setIndex = Math.floor(Math.random() * objectSets.length);
    setCurrentSetIndex(setIndex);

    const positions: ObjectPosition[] = ['left', 'center', 'right'];
    const pointedPos = positions[Math.floor(Math.random() * positions.length)];
    setPointedPosition(pointedPos);

    // Show objects first
    setTimeout(() => {
      showObjects();
    }, 500);

    // Then point after objects are visible
    setTimeout(() => {
      pointAtPosition(pointedPos);
    }, 1500);
  }, []);

  const showObjects = () => {
    Animated.parallel([
      Animated.spring(objectsScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(objectsOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const pointAtPosition = (position: ObjectPosition) => {
    setIsPointing(true);
    
    // Calculate the actual angle to the object for proper arm rotation
    const avatarCenterX = SCREEN_WIDTH / 2;
    const avatarCenterY = SCREEN_HEIGHT * 0.25;
    const objectY = SCREEN_HEIGHT * 0.5;
    
    let objectCenterX: number;
    if (position === 'left') {
      objectCenterX = SCREEN_WIDTH * 0.2;
    } else if (position === 'center') {
      objectCenterX = SCREEN_WIDTH / 2;
    } else {
      objectCenterX = SCREEN_WIDTH * 0.8;
    }
    
    const dx = objectCenterX - avatarCenterX;
    const dy = objectY - avatarCenterY;
    const calculatedAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    Animated.parallel([
      Animated.timing(armRotation, {
        toValue: calculatedAngle,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(armOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pointingLineOpacity, {
        toValue: 0.8,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleObjectTap = (position: ObjectPosition) => {
    if (!isPointing || selectedPosition !== null) return;

    setSelectedPosition(position);
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const isCorrect = position === pointedPosition;
    const scaleAnim = position === 'left' ? leftObjectScale : position === 'center' ? centerObjectScale : rightObjectScale;

    if (isCorrect) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.5,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();

      Animated.parallel([
        Animated.timing(objectsOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
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
    } else {
      // Wrong answer - shake animation
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

      speak('Try again!');
      setTimeout(() => {
        setSelectedPosition(null);
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
  const currentObjects = objectSets[currentSetIndex];
  const leftObj = currentObjects.find(o => o.position === 'left')!;
  const centerObj = currentObjects.find(o => o.position === 'center')!;
  const rightObj = currentObjects.find(o => o.position === 'right')!;

  // Calculate pointing line properties
  const avatarCenterX = SCREEN_WIDTH / 2;
  const avatarCenterY = SCREEN_HEIGHT * 0.25;
  const objectY = SCREEN_HEIGHT * 0.5;
  
  const getPointingLineProps = (position: ObjectPosition) => {
    let objectCenterX: number;
    if (position === 'left') {
      objectCenterX = SCREEN_WIDTH * 0.2;
    } else if (position === 'center') {
      objectCenterX = SCREEN_WIDTH / 2;
    } else {
      objectCenterX = SCREEN_WIDTH * 0.8;
    }
    
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
  
  const lineProps = isPointing ? getPointingLineProps(pointedPosition) : null;

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
            <Text style={styles.title}>Tap the Pointed Object</Text>
            <Text style={styles.subtitle}>
              {isPointing ? '👆 Which one am I pointing to?' : 'Watch for my pointing!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          <View style={[
            styles.avatarContainer,
            {
              left: SCREEN_WIDTH / 2 - AVATAR_SIZE / 2,
              top: SCREEN_HEIGHT * 0.25 - AVATAR_SIZE / 2,
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

          {/* Objects */}
          <Animated.View
            style={[
              styles.objectsContainer,
              {
                opacity: objectsOpacity,
                transform: [{ scale: objectsScale }],
              },
            ]}
          >
            {/* Left Object */}
            <Pressable
              onPress={() => handleObjectTap('left')}
              disabled={!isPointing || selectedPosition !== null}
              style={styles.objectPressable}
            >
              <Animated.View
                style={[
                  styles.objectContainer,
                  {
                    transform: [{ scale: leftObjectScale }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[leftObj.color + 'CC', leftObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{leftObj.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>

            {/* Center Object */}
            <Pressable
              onPress={() => handleObjectTap('center')}
              disabled={!isPointing || selectedPosition !== null}
              style={styles.objectPressable}
            >
              <Animated.View
                style={[
                  styles.objectContainer,
                  {
                    transform: [{ scale: centerObjectScale }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[centerObj.color + 'CC', centerObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{centerObj.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>

            {/* Right Object */}
            <Pressable
              onPress={() => handleObjectTap('right')}
              disabled={!isPointing || selectedPosition !== null}
              style={styles.objectPressable}
            >
              <Animated.View
                style={[
                  styles.objectContainer,
                  {
                    transform: [{ scale: rightObjectScale }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[rightObj.color + 'CC', rightObj.color]}
                  style={styles.object}
                >
                  <Text style={styles.objectEmoji}>{rightObj.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          </Animated.View>

          {!isPointing && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Watch for my pointing!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🎯 Discrimination • 🤝 Social Interpretation • 📱 AAC Preparation
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
  objectsContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 200,
    elevation: 15,
  },
  objectPressable: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
  },
  objectContainer: {
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

