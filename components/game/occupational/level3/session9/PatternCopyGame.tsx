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
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PATTERN_DISPLAY_TIME = 4000; // Time to show pattern (ms)
const RESPONSE_TIME = 5000; // Time to repeat pattern (ms)

type Movement = 'up' | 'down' | 'left' | 'right' | 'tap';

const MOVEMENT_EMOJIS: Record<Movement, string> = {
  'up': '⬆️',
  'down': '⬇️',
  'left': '⬅️',
  'right': '➡️',
  'tap': '👆',
};

const PatternCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPattern, setShowPattern] = useState(false);
  const [pattern, setPattern] = useState<Movement[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [canCopy, setCanCopy] = useState(false);
  const [userPattern, setUserPattern] = useState<Movement[]>([]);
  const [hasCopied, setHasCopied] = useState(false);

  const movementScale = useRef(new Animated.Value(1)).current;
  const movementOpacity = useRef(new Animated.Value(0)).current;
  const patternTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stepTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const generatePattern = useCallback((): Movement[] => {
    const movements: Movement[] = ['up', 'down', 'left', 'right', 'tap'];
    const patternLength = 3; // 3 movements in pattern
    const newPattern: Movement[] = [];
    for (let i = 0; i < patternLength; i++) {
      newPattern.push(movements[Math.floor(Math.random() * movements.length)]);
    }
    return newPattern;
  }, []);

  const showPatternOnScreen = useCallback(() => {
    if (done) return;

    const newPattern = generatePattern();
    setPattern(newPattern);
    setCurrentStep(0);
    setUserPattern([]);
    
    setShowPattern(true);
    setCanCopy(false);
    setHasCopied(false);
    movementOpacity.setValue(0);
    movementScale.setValue(0.5);
    
    // Show pattern step by step
    let stepIndex = 0;
    const showStep = () => {
      if (stepIndex < newPattern.length) {
        setCurrentStep(stepIndex);
        movementOpacity.setValue(0);
        movementScale.setValue(0.5);
        
        Animated.parallel([
          Animated.spring(movementScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(movementOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        stepTimeoutRef.current = setTimeout(() => {
          movementOpacity.setValue(0);
          stepIndex++;
          if (stepIndex < newPattern.length) {
            showStep();
          } else {
            // Pattern complete, now allow copying
            setCanCopy(true);
            if (Platform.OS === 'web') {
              setTimeout(() => {
                speakTTS('Now repeat the pattern!', 0.8, 'en-US' );
              }, 300);
            } else {
              speakTTS('Now repeat the pattern!', 0.8, 'en-US' );
            }

            copyTimeoutRef.current = setTimeout(() => {
              setCanCopy(false);
              if (!hasCopied || userPattern.length !== newPattern.length) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                speakTTS('Repeat the pattern!', 0.8, 'en-US' );
                setTimeout(() => {
                  if (round < TOTAL_ROUNDS) {
                    setRound((r) => r + 1);
                    setShowPattern(false);
                    movementOpacity.setValue(0);
                    movementScale.setValue(1);
                  } else {
                    endGame();
                  }
                }, 1000);
              }
            }, RESPONSE_TIME) as unknown as NodeJS.Timeout;
          }
        }, 1000) as unknown as NodeJS.Timeout;
      }
    };
    
    setTimeout(() => {
      showStep();
    }, 500);

    patternTimeoutRef.current = setTimeout(() => {
      // Pattern display complete
    }, PATTERN_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, movementScale, movementOpacity, round, hasCopied, userPattern, generatePattern]);

  const handleCopy = useCallback((movement: Movement) => {
    if (!canCopy || done || !showPattern || hasCopied) return;

    const newUserPattern = [...userPattern, movement];
    setUserPattern(newUserPattern);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Check if pattern is complete
    if (newUserPattern.length === pattern.length) {
      // Check if pattern matches
      const matches = newUserPattern.every((move, idx) => move === pattern[idx]);
      
      if (matches) {
        setHasCopied(true);
        setScore((s) => s + 1);
        
        if (copyTimeoutRef.current) {
          clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = null;
        }
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect pattern!', 0.9, 'en-US' );
        
        Animated.sequence([
          Animated.timing(movementScale, {
            toValue: 1.3,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(movementScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();

        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            setShowPattern(false);
            movementOpacity.setValue(0);
            movementScale.setValue(1);
          } else {
            endGame();
          }
        }, 1000);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Pattern did not match! Try again!', 0.8, 'en-US' );
        setUserPattern([]);
      }
    }
  }, [canCopy, done, showPattern, hasCopied, userPattern, pattern, movementScale, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showPatternOnScreen();
    }, 500);
  }, [done, showPatternOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPattern(false);

    if (patternTimeoutRef.current) {
      clearTimeout(patternTimeoutRef.current);
    }
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    if (stepTimeoutRef.current) {
      clearTimeout(stepTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'pattern-copy',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['memory', 'motor', 'pattern-recognition'],
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
      if (patternTimeoutRef.current) {
        clearTimeout(patternTimeoutRef.current);
      }
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      if (stepTimeoutRef.current) {
        clearTimeout(stepTimeoutRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Pattern Copy"
        emoji="🔄"
        description="Watch the movement pattern and repeat it!"
        skills={['Memory', 'Motor', 'Pattern recognition']}
        suitableFor="Children learning memory and motor pattern recognition"
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
            setShowPattern(false);
            setHasCopied(false);
            setUserPattern([]);
            movementOpacity.setValue(0);
            movementScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  const currentMovement = pattern[currentStep] || null;
  const isShowingPattern = showPattern && !canCopy;
  const progress = canCopy ? `${userPattern.length}/${pattern.length}` : '';

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
        <Text style={styles.title}>Pattern Copy</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔄 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {isShowingPattern ? 'Watch the pattern...' : canCopy ? `Repeat the pattern! ${progress}` : 'Get ready...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPattern && (
          <View style={styles.patternContainer}>
            {isShowingPattern && currentMovement && (
              <Animated.View
                style={[
                  styles.movementContainer,
                  {
                    transform: [{ scale: movementScale }],
                    opacity: movementOpacity,
                  },
                ]}
              >
                <Text style={styles.movementEmoji}>{MOVEMENT_EMOJIS[currentMovement]}</Text>
                <Text style={styles.movementLabel}>{currentMovement.toUpperCase()}</Text>
              </Animated.View>
            )}

            {canCopy && (
              <View style={styles.copyControls}>
                <Text style={styles.copyInstruction}>Tap to repeat pattern:</Text>
                <View style={styles.movementButtons}>
                  {(['up', 'down', 'left', 'right', 'tap'] as Movement[]).map((move) => (
                    <TouchableOpacity
                      key={move}
                      style={styles.movementButton}
                      onPress={() => handleCopy(move)}
                    >
                      <Text style={styles.movementButtonEmoji}>{MOVEMENT_EMOJIS[move]}</Text>
                      <Text style={styles.movementButtonLabel}>{move.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {userPattern.length > 0 && (
                  <Text style={styles.progressText}>
                    Your pattern: {userPattern.map(m => MOVEMENT_EMOJIS[m]).join(' ')}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {!showPattern && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Memory • Motor • Pattern recognition
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the pattern and repeat it in the same order!
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
    color: '#8B5CF6',
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
  patternContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  movementContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  movementEmoji: {
    fontSize: 120,
    marginBottom: 10,
  },
  movementLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8B5CF6',
  },
  copyControls: {
    alignItems: 'center',
    marginTop: 40,
  },
  copyInstruction: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 20,
  },
  movementButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 15,
  },
  movementButton: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    padding: 15,
    borderRadius: 20,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  movementButtonEmoji: {
    fontSize: 40,
    marginBottom: 5,
  },
  movementButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  progressText: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: '600',
    color: '#3B82F6',
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

export default PatternCopyGame;
