import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
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
const ARROW_SIZE = 150;

type ArrowDirection = 'left' | 'right' | 'up' | 'down';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const ArrowTouchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [arrowDirection, setArrowDirection] = useState<ArrowDirection>('left');
  const [expectedHand, setExpectedHand] = useState<'left' | 'right'>('right');
  const [showArrow, setShowArrow] = useState(false);

  const arrowScale = useSharedValue(1);
  const arrowOpacity = useSharedValue(0);
  const leftHandScale = useSharedValue(1);
  const rightHandScale = useSharedValue(1);

  const generateArrow = useCallback(() => {
    const directions: ArrowDirection[] = ['left', 'right', 'up', 'down'];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    setArrowDirection(dir);
    
    // Cross-body mapping: left arrow → right hand, right arrow → left hand
    // Up/Down can be either, but we'll use cross-body for consistency
    if (dir === 'left') {
      setExpectedHand('right');
    } else if (dir === 'right') {
      setExpectedHand('left');
    } else {
      // For up/down, randomly assign cross-body
      setExpectedHand(Math.random() < 0.5 ? 'left' : 'right');
    }
    
    setShowArrow(true);
    arrowOpacity.value = 0;
    arrowScale.value = 0.5;
    
    arrowOpacity.value = withTiming(1, { duration: 300 });
    arrowScale.value = withSpring(1, { damping: 10, stiffness: 100 });
    
    const instruction = dir === 'left' 
      ? 'Left arrow, use right hand!' 
      : dir === 'right'
      ? 'Right arrow, use left hand!'
      : `Arrow ${dir}, use ${expectedHand} hand!`;
    
    speak(instruction, 0.8);
  }, [arrowOpacity, arrowScale, expectedHand]);

  const handleLeftHandTap = useCallback(() => {
    if (done || !showArrow) return;
    
    if (expectedHand === 'left') {
      // Correct!
      setScore((s) => s + 1);
      leftHandScale.value = withSequence(
        withSpring(1.3, { damping: 8 }),
        withSpring(1, { damping: 8 })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!', 0.9, 'en-US');
      
      // Hide arrow and prepare next round
      arrowOpacity.value = withTiming(0, { duration: 200 });
      setShowArrow(false);
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          generateArrow();
        } else {
          endGame();
        }
      }, 1000);
    } else {
      // Wrong hand
      leftHandScale.value = withSequence(
        withSpring(0.8, { damping: 8 }),
        withSpring(1, { damping: 8 })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speak(`Use ${expectedHand} hand!`, 0.8);
    }
  }, [done, showArrow, expectedHand, round, leftHandScale, arrowOpacity, generateArrow]);

  const handleRightHandTap = useCallback(() => {
    if (done || !showArrow) return;
    
    if (expectedHand === 'right') {
      // Correct!
      setScore((s) => s + 1);
      rightHandScale.value = withSequence(
        withSpring(1.3, { damping: 8 }),
        withSpring(1, { damping: 8 })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!', 0.9, 'en-US');
      
      // Hide arrow and prepare next round
      arrowOpacity.value = withTiming(0, { duration: 200 });
      setShowArrow(false);
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          generateArrow();
        } else {
          endGame();
        }
      }, 1000);
    } else {
      // Wrong hand
      rightHandScale.value = withSequence(
        withSpring(0.8, { damping: 8 }),
        withSpring(1, { damping: 8 })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speak(`Use ${expectedHand} hand!`, 0.8);
    }
  }, [done, showArrow, expectedHand, round, rightHandScale, arrowOpacity, generateArrow]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowArrow(false);

    try {
      await logGameAndAward({
        type: 'arrow-touch',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['brain-crossover', 'cross-body-coordination', 'visual-motor'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        generateArrow();
      }, 500);
    }
  }, [showInfo, round, done, generateArrow]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: arrowScale.value }],
    opacity: arrowOpacity.value,
  }));

  const leftHandStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftHandScale.value }],
  }));

  const rightHandStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightHandScale.value }],
  }));

  const getArrowEmoji = (dir: ArrowDirection) => {
    switch (dir) {
      case 'left': return '⬅️';
      case 'right': return '➡️';
      case 'up': return '⬆️';
      case 'down': return '⬇️';
    }
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Arrow Touch"
        emoji="⬅️"
        description="Left arrow → right hand! Cross-body brain training!"
        skills={['Brain crossover', 'Cross-body coordination']}
        suitableFor="Children learning cross-body coordination and brain crossover"
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
            setShowArrow(false);
            arrowOpacity.value = 0;
            arrowScale.value = 1;
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
        <Text style={styles.title}>Arrow Touch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⬅️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showArrow && `Arrow ${arrowDirection} → Use ${expectedHand} hand!`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showArrow && (
          <Animated.View style={[styles.arrowContainer, arrowStyle]}>
            <Text style={styles.arrowEmoji}>{getArrowEmoji(arrowDirection)}</Text>
            <Text style={styles.arrowLabel}>
              {arrowDirection.toUpperCase()}
            </Text>
          </Animated.View>
        )}

        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={handleLeftHandTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.handTarget, styles.leftHand, leftHandStyle]}>
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>LEFT</Text>
              {showArrow && expectedHand === 'left' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={handleRightHandTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.handTarget, styles.rightHand, rightHandStyle]}>
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>RIGHT</Text>
              {showArrow && expectedHand === 'right' && (
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
          Skills: Brain crossover • Cross-body coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Left arrow → right hand! Cross-body brain training!
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
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 60,
  },
  arrowEmoji: {
    fontSize: 120,
    marginBottom: 10,
  },
  arrowLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginTop: 40,
  },
  handButton: {
    width: 140,
    height: 140,
  },
  handTarget: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    position: 'relative',
  },
  leftHand: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHand: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  handLabel: {
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

export default ArrowTouchGame;
