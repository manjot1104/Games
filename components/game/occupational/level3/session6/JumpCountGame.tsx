import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FROG_START_Y = SCREEN_HEIGHT * 0.7;
const FROG_JUMP_Y = SCREEN_HEIGHT * 0.4;

const JumpCountGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showFrog, setShowFrog] = useState(false);
  const [hasJumped, setHasJumped] = useState(false);
  const [currentNumber, setCurrentNumber] = useState<number | null>(null);
  const [canJump, setCanJump] = useState(false);

  const frogY = useRef(new Animated.Value(FROG_START_Y)).current;
  const frogScale = useRef(new Animated.Value(1)).current;
  const numberScale = useRef(new Animated.Value(1)).current;
  const numberOpacity = useRef(new Animated.Value(0)).current;
  const numberTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showNumber = useCallback(() => {
    if (done || !showFrog || hasJumped) return;

    // Random number between 1-3, but we only want "2" for jump
    const num = Math.floor(Math.random() * 3) + 1; // 1, 2, or 3
    setCurrentNumber(num);
    setCanJump(num === 2);
    
    numberOpacity.setValue(0);
    numberScale.setValue(0.5);
    
    Animated.parallel([
      Animated.spring(numberScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(numberOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (num === 2) {
      speakTTS('Number 2! Now jump!', 0.8, 'en-US' );
    } else {
      speakTTS(`Number ${num}! Don't jump!`, 0.8, 'en-US' );
    }

    // Hide number after 2 seconds
    numberTimeoutRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(numberOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(numberScale, {
          toValue: 0.5,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrentNumber(null);
        setCanJump(false);
      });
    }, 2000) as unknown as NodeJS.Timeout;
  }, [done, showFrog, hasJumped, numberOpacity, numberScale]);

  const handleJump = useCallback(() => {
    if (done || !showFrog || hasJumped || currentNumber === null) return;

    if (canJump && currentNumber === 2) {
      // Correct! Jump allowed when 2 appears
      handleSuccess();
    } else {
      // Wrong! Jumped when not 2 or no number shown
      handleMiss();
    }
  }, [done, showFrog, hasJumped, canJump, currentNumber]);

  const handleSuccess = useCallback(() => {
    setHasJumped(true);
    setScore((s) => s + 1);
    
    if (numberTimeoutRef.current) {
      clearTimeout(numberTimeoutRef.current);
      numberTimeoutRef.current = null;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect! 2 pe jump kiya!', 0.9 );
    
    // Jump animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(frogY, {
          toValue: FROG_JUMP_Y,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(frogScale, {
            toValue: 1.3,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(frogScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(frogY, {
        toValue: FROG_START_Y,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowFrog(false);
        setHasJumped(false);
        setCurrentNumber(null);
        setCanJump(false);
        frogY.setValue(FROG_START_Y);
        frogScale.setValue(1);
        numberOpacity.setValue(0);
        numberScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, frogY, frogScale, numberOpacity, numberScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    
    if (currentNumber && currentNumber !== 2) {
      speakTTS(`Don't jump on ${currentNumber}! Only jump on 2!`, 0.8, 'en-US' );
    } else {
      speakTTS('Only jump on 2!', 0.8, 'en-US' );
    }
    
    // Shake animation
    Animated.sequence([
      Animated.timing(frogScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(frogScale, {
        toValue: 1.1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(frogScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [frogScale, currentNumber]);

  const showFrogObject = useCallback(() => {
    setShowFrog(true);
    setHasJumped(false);
    setCurrentNumber(null);
    setCanJump(false);
    frogY.setValue(FROG_START_Y);
    frogScale.setValue(1);
    numberOpacity.setValue(0);
    numberScale.setValue(1);
    
    // Show number after a delay
    setTimeout(() => {
      showNumber();
    }, 1000);
  }, [frogScale, frogY, numberOpacity, numberScale, showNumber]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showFrogObject();
    }, 500);
  }, [done, showFrogObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowFrog(false);

    if (numberTimeoutRef.current) {
      clearTimeout(numberTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'jump-count',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['number-motor-link', 'selective-response'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (numberTimeoutRef.current) {
        clearTimeout(numberTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Jump Count"
        emoji="🔢"
        description="Jump only when '2' appears! Sirf 2 pe jump karo!"
        skills={['Number-motor link', 'Selective response']}
        suitableFor="Children learning number-motor coordination and selective response"
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

  // Result screen
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
            setShowFrog(false);
            setHasJumped(false);
            setCurrentNumber(null);
            setCanJump(false);
            frogY.setValue(FROG_START_Y);
            frogScale.setValue(1);
            numberOpacity.setValue(0);
            numberScale.setValue(1);
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
        <Text style={styles.title}>Jump Count</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔢 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Only jump on '2'!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showFrog && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleJump}
            style={styles.tapArea}
          >
            <Animated.View
              style={[
                styles.frogContainer,
                {
                  top: frogY,
                  transform: [{ scale: frogScale }],
                },
              ]}
            >
              <Text style={styles.frogEmoji}>🐸</Text>
            </Animated.View>

            {currentNumber !== null && (
              <Animated.View
                style={[
                  styles.numberContainer,
                  {
                    transform: [{ scale: numberScale }],
                    opacity: numberOpacity,
                  },
                ]}
              >
                <Text style={[
                  styles.numberText,
                  { color: currentNumber === 2 ? '#22C55E' : '#EF4444' }
                ]}>
                  {currentNumber}
                </Text>
                {currentNumber === 2 && (
                  <Text style={styles.jumpLabel}>JUMP!</Text>
                )}
              </Animated.View>
            )}
          </TouchableOpacity>
        )}

        {!showFrog && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Number-motor link • Selective response
        </Text>
        <Text style={styles.footerSubtext}>
          Jump only when the number 2 appears!
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
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frogContainer: {
    position: 'absolute',
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -75,
  },
  frogEmoji: {
    fontSize: 120,
  },
  numberContainer: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: 120,
    fontWeight: '900',
    marginBottom: 10,
  },
  jumpLabel: {
    fontSize: 32,
    fontWeight: '800',
    color: '#22C55E',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
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

export default JumpCountGame;


