import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRUM_SIZE = 140;
const BEAT_INTERVAL = 2000; // 2 seconds between beats
const BEATS_PER_ROUND = 4; // 4 beats per round (alternating)

const DrumAlternateGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [beatCount, setBeatCount] = useState(0);
  const [expectedHand, setExpectedHand] = useState<'left' | 'right'>('left');
  const [waitingForBeat, setWaitingForBeat] = useState(false);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftRotation = useSharedValue(0);
  const rightRotation = useSharedValue(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const beatTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerBeat = useCallback(() => {
    if (done) return;
    setWaitingForBeat(true);
    
    speakTTS(`Tap ${expectedHand} drum!`, 0.8, 'en-US' );
    
    // Visual cue - highlight expected drum
    if (expectedHand === 'left') {
      leftScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    } else {
      rightScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    }
  }, [done, expectedHand, leftScale, rightScale]);

  const handleLeftDrum = useCallback(() => {
    if (done || !waitingForBeat || expectedHand !== 'left') {
      if (waitingForBeat && expectedHand === 'right') {
        // Wrong drum
        leftScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Alternate! Use right drum!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    setWaitingForBeat(false);
    leftScale.value = withSequence(
      withSpring(0.8),
      withSpring(1)
    );
    leftRotation.value = withSequence(
      withSpring(-10),
      withSpring(0)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    
    setBeatCount((c) => {
      const newCount = c + 1;
      if (newCount >= BEATS_PER_ROUND) {
        // Round complete!
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setBeatCount(0);
              setExpectedHand('left');
              triggerBeat();
            }, 1500);
          }
          return newScore;
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect rhythm!', 0.9, 'en-US' );
      } else {
        // Continue to next beat - alternate
        const nextHand = expectedHand === 'left' ? 'right' : 'left';
        setExpectedHand(nextHand);
        setTimeout(() => {
          triggerBeat();
        }, BEAT_INTERVAL);
      }
      return newCount;
    });
  }, [done, waitingForBeat, expectedHand, leftScale, leftRotation, triggerBeat]);

  const handleRightDrum = useCallback(() => {
    if (done || !waitingForBeat || expectedHand !== 'right') {
      if (waitingForBeat && expectedHand === 'left') {
        // Wrong drum
        rightScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Alternate! Use left drum!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    setWaitingForBeat(false);
    rightScale.value = withSequence(
      withSpring(0.8),
      withSpring(1)
    );
    rightRotation.value = withSequence(
      withSpring(10),
      withSpring(0)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    
    setBeatCount((c) => {
      const newCount = c + 1;
      if (newCount >= BEATS_PER_ROUND) {
        // Round complete!
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setBeatCount(0);
              setExpectedHand('left');
              triggerBeat();
            }, 1500);
          }
          return newScore;
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect rhythm!', 0.9, 'en-US' );
      } else {
        // Continue to next beat - alternate
        const nextHand = expectedHand === 'left' ? 'right' : 'left';
        setExpectedHand(nextHand);
        setTimeout(() => {
          triggerBeat();
        }, BEAT_INTERVAL);
      }
      return newCount;
    });
  }, [done, waitingForBeat, expectedHand, rightScale, rightRotation, triggerBeat]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setWaitingForBeat(false);

    if (beatTimerRef.current) {
      clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      beatTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'drum-alternate',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm-control', 'alternating-hands', 'coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setBeatCount(0);
      setExpectedHand('left');
      setTimeout(() => {
        triggerBeat();
      }, 500);
    }
  }, [showInfo, round, done, triggerBeat]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (beatTimerRef.current) {
        clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
    };
  }, []);

  const leftDrumStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: leftScale.value },
      { rotate: `${leftRotation.value}deg` },
    ],
  }));

  const rightDrumStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: rightScale.value },
      { rotate: `${rightRotation.value}deg` },
    ],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Drum Alternate"
        emoji="🥁"
        description="Left drum → right drum - rhythm control!"
        skills={['Rhythm control']}
        suitableFor="Children learning rhythm control through alternating drum taps"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setBeatCount(0);
            setExpectedHand('left');
            triggerBeat();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Drum Alternate</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🥁 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {waitingForBeat
            ? `Tap ${expectedHand.toUpperCase()} drum! (${beatCount + 1}/${BEATS_PER_ROUND})`
            : 'Get ready...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.drumsContainer}>
          <TouchableOpacity
            style={styles.drumWrapper}
            onPress={handleLeftDrum}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.drum, styles.leftDrum, leftDrumStyle]}>
              <Text style={styles.drumEmoji}>🥁</Text>
              <Text style={styles.drumLabel}>LEFT</Text>
              {waitingForBeat && expectedHand === 'left' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.drumWrapper}
            onPress={handleRightDrum}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.drum, styles.rightDrum, rightDrumStyle]}>
              <Text style={styles.drumEmoji}>🥁</Text>
              <Text style={styles.drumLabel}>RIGHT</Text>
              {waitingForBeat && expectedHand === 'right' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Rhythm control
        </Text>
        <Text style={styles.footerSubtext}>
          Tap left drum, then right drum, alternating!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  drumsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  drumWrapper: {
    width: DRUM_SIZE,
    height: DRUM_SIZE,
  },
  drum: {
    width: DRUM_SIZE,
    height: DRUM_SIZE,
    borderRadius: DRUM_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    position: 'relative',
  },
  leftDrum: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  rightDrum: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  drumEmoji: {
    fontSize: 60,
    marginBottom: 5,
  },
  drumLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  highlightIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  highlightText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default DrumAlternateGame;
