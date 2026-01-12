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

const AVATAR_SIZE = 120;
const OBJECT_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;

type LookDirection = 'left' | 'right';

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
  { emoji: '🎈', name: 'toy', color: '#EF4444' },
  { emoji: '🧸', name: 'toy', color: '#F59E0B' },
  { emoji: '🚗', name: 'toy', color: '#3B82F6' },
  { emoji: '⚽', name: 'toy', color: '#22C55E' },
];

export const WhichSideGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hits, setHits] = useState(0);
  const [currentDirection, setCurrentDirection] = useState<LookDirection>('left');
  const [round, setRound] = useState(0);
  const [isLooking, setIsLooking] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTaps: number;
    correctTaps: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const avatarScale = useRef(new Animated.Value(1)).current;
  const avatarEyeX = useRef(new Animated.Value(0)).current;
  const leftScale = useRef(new Animated.Value(1)).current;
  const rightScale = useRef(new Animated.Value(1)).current;
  const leftGlow = useRef(new Animated.Value(0.5)).current;
  const rightGlow = useRef(new Animated.Value(0.5)).current;
  const gazeLineOpacity = useRef(new Animated.Value(0)).current;
  const gazeLineScale = useRef(new Animated.Value(0)).current;

  const [leftObject, setLeftObject] = useState(0);
  const [rightObject, setRightObject] = useState(1);

  useEffect(() => {
    startRound();
    speak('I\'m looking at one of the toys. Can you find it?');
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  useEffect(() => {
    if (hits >= (requiredTaps || 5) && !gameFinished) {
      finishGame();
    }
  }, [hits, requiredTaps, gameFinished]);

  const finishGame = useCallback(async () => {
    if (gameFinished) return;
    
    const stats = {
      totalTaps: requiredTaps || 5,
      correctTaps: hits,
      accuracy: Math.round((hits / (requiredTaps || 5)) * 100),
    };
    setFinalStats(stats);
    setGameFinished(true);
    speak('Amazing! You found all the toys!');

    try {
      const xpAwarded = hits * 10;
      const result = await logGameAndAward({
        type: 'follow-my-point',
        correct: hits,
        total: requiredTaps || 5,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['gaze-matching', 'visual-scanning', 'decision-making'],
        meta: {
          totalTaps: requiredTaps || 5,
          correctTaps: hits,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [hits, requiredTaps, gameFinished]);

  const startRound = useCallback(() => {
    setRound((prev) => prev + 1);
    setIsLooking(false);
    
    leftScale.setValue(1);
    rightScale.setValue(1);
    leftGlow.setValue(0.5);
    rightGlow.setValue(0.5);
    gazeLineOpacity.setValue(0);
    gazeLineScale.setValue(0);
    avatarEyeX.setValue(0);

    const direction: LookDirection = Math.random() > 0.5 ? 'left' : 'right';
    setCurrentDirection(direction);

    const leftIdx = Math.floor(Math.random() * objects.length);
    let rightIdx = Math.floor(Math.random() * objects.length);
    while (rightIdx === leftIdx) {
      rightIdx = Math.floor(Math.random() * objects.length);
    }
    setLeftObject(leftIdx);
    setRightObject(rightIdx);

    setTimeout(() => {
      lookAtDirection(direction);
    }, 500);
  }, []);

  const lookAtDirection = (direction: LookDirection) => {
    setIsLooking(true);
    
    const eyeOffset = direction === 'left' ? -8 : 8;
    Animated.timing(avatarEyeX, {
      toValue: eyeOffset,
      duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

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

    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(leftGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(rightGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(leftGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(rightGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ])
    ).start();
  };

  const handleTap = (side: 'left' | 'right') => {
    if (!isLooking) return;

    const isCorrect = (side === 'left' && currentDirection === 'left') || 
                     (side === 'right' && currentDirection === 'right');
    
    const tappedScale = side === 'left' ? leftScale : rightScale;
    
    if (isCorrect) {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      
      Animated.sequence([
        Animated.spring(tappedScale, {
          toValue: 1.3,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.spring(tappedScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        setShowRoundSuccess(false);
        const nextHits = hits + 1;
        setHits(nextHits);

        if (nextHits < (requiredTaps || 5)) {
          setTimeout(() => {
            startRound();
          }, 500);
        }
      }, 2500);
    } else {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
      speak('Try again!');
      
      Animated.sequence([
        Animated.timing(tappedScale, {
          toValue: 0.9,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(tappedScale, {
          toValue: 1,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Great Eye Tracking!"
        showButtons={true}
        correct={finalStats.correctTaps}
        total={finalStats.totalTaps}
        accuracy={accuracyPct}
        xpAwarded={finalStats.correctTaps * 10}
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

  const progressDots = Array.from({ length: requiredTaps || 5 }, (_, i) => i < hits);
  const leftObj = objects[leftObject];
  const rightObj = objects[rightObject];
  const leftX = SCREEN_WIDTH * 0.2;
  const rightX = SCREEN_WIDTH * 0.8;
  const objectY = SCREEN_HEIGHT * 0.5;

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
            <Text style={styles.title}>Which Side?</Text>
            <Text style={styles.subtitle}>
              {isLooking ? `👀 Looking ${currentDirection}...` : 'Watch my eyes!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          <View style={[
            styles.avatarContainer,
            {
              left: SCREEN_WIDTH / 2 - AVATAR_SIZE / 2,
              top: SCREEN_HEIGHT * 0.35 - AVATAR_SIZE / 2,
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
                  <View style={styles.smile} />
                </View>
              </LinearGradient>
            </Animated.View>
          </View>

          {isLooking && (
            <Animated.View
              style={[
                styles.gazeLine,
                {
                  left: SCREEN_WIDTH / 2,
                  top: SCREEN_HEIGHT * 0.35,
                  width: SCREEN_WIDTH * 0.3,
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

          <Pressable
            onPress={() => handleTap('left')}
            hitSlop={30}
            style={[styles.objectContainer, { left: leftX - OBJECT_SIZE / 2, top: objectY - OBJECT_SIZE / 2 }]}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [{ scale: leftScale }],
                  shadowColor: leftObj.color,
                  shadowOpacity: leftGlow.interpolate({
                    inputRange: [0.5, 1],
                    outputRange: [0.3, 0.7],
                  }),
                  shadowRadius: 30,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 15,
                },
              ]}
            >
              <LinearGradient
                colors={[leftObj.color + 'CC', leftObj.color]}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>{leftObj.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          <Pressable
            onPress={() => handleTap('right')}
            hitSlop={30}
            style={[styles.objectContainer, { left: rightX - OBJECT_SIZE / 2, top: objectY - OBJECT_SIZE / 2 }]}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [{ scale: rightScale }],
                  shadowColor: rightObj.color,
                  shadowOpacity: rightGlow.interpolate({
                    inputRange: [0.5, 1],
                    outputRange: [0.3, 0.7],
                  }),
                  shadowRadius: 30,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 15,
                },
              ]}
            >
              <LinearGradient
                colors={[rightObj.color + 'CC', rightObj.color]}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>{rightObj.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {!isLooking && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👀 Watch where I look!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            👁️ Gaze Matching • 🔍 Visual Scanning • 🧠 Decision-Making
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
            {hits >= (requiredTaps || 5) ? '🎊 Amazing! You did it! 🎊' : `Round ${round} • Correct: ${hits} / ${requiredTaps || 5}`}
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
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    overflow: 'hidden',
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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

