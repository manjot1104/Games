import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
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
const MAX_TAP_DELAY = 500; // Maximum time between 2 taps (ms)
const CHARACTER_START_Y = SCREEN_HEIGHT * 0.7;
const CHARACTER_JUMP_Y = SCREEN_HEIGHT * 0.4;
const OBSTACLE_START_X = SCREEN_WIDTH + 100;
const OBSTACLE_END_X = -100;
const OBSTACLE_Y = SCREEN_HEIGHT * 0.75;
const OBSTACLE_SPEED = 2000; // ms to cross screen

const ObstacleJumpGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showObstacle, setShowObstacle] = useState(false);
  const [hasJumped, setHasJumped] = useState(false);
  const [obstacleHit, setObstacleHit] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const characterY = useRef(new Animated.Value(CHARACTER_START_Y)).current;
  const characterScale = useRef(new Animated.Value(1)).current;
  const obstacleX = useRef(new Animated.Value(OBSTACLE_START_X)).current;
  const firstTapTime = useRef<number | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const obstacleAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const handleTap = useCallback(() => {
    if (done || !showCharacter || hasJumped || !showObstacle) return;

    const now = Date.now();

    if (firstTapTime.current === null) {
      // First tap
      firstTapTime.current = now;
      setTapCount(1);
      
      // Set timeout - if second tap doesn't come in time, reset
      tapTimeoutRef.current = setTimeout(() => {
        setTapCount(0);
        firstTapTime.current = null;
      }, MAX_TAP_DELAY) as unknown as NodeJS.Timeout;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      // Second tap
      const timeDiff = now - firstTapTime.current;

      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }

      if (timeDiff <= MAX_TAP_DELAY) {
        // Success! Double tap detected - jump!
        setTapCount(2);
        handleJump();
      } else {
        // Too slow, reset
        setTapCount(0);
        firstTapTime.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Speech.speak('Tez se do baar tap karo!', { rate: 0.8 });
      }
    }
  }, [done, showCharacter, hasJumped, showObstacle]);

  const handleJump = useCallback(() => {
    setHasJumped(true);
    firstTapTime.current = null;
    setTapCount(0);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    // Jump animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(characterY, {
          toValue: CHARACTER_JUMP_Y,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(characterScale, {
            toValue: 1.3,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(characterScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(characterY, {
        toValue: CHARACTER_START_Y,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    // Check if obstacle was cleared (approximate - if jump happened while obstacle is not in danger zone)
    setTimeout(() => {
      // Stop obstacle animation
      if (obstacleAnimationRef.current) {
        obstacleAnimationRef.current.stop();
      }

      // Assume jump was successful if executed in time
      setScore((s) => s + 1);
      Speech.speak('Perfect jump! Obstacle clear!', { rate: 0.9 });

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowCharacter(false);
          setShowObstacle(false);
          setHasJumped(false);
          setObstacleHit(false);
          characterY.setValue(CHARACTER_START_Y);
          characterScale.setValue(1);
          obstacleX.setValue(OBSTACLE_START_X);
        } else {
          endGame();
        }
      }, 1000);
    }, 600);
  }, [round, characterY, characterScale, obstacleX]);

  const startObstacle = useCallback(() => {
    if (done || !showCharacter) return;

    setShowObstacle(true);
    obstacleX.setValue(OBSTACLE_START_X);
    setHasJumped(false);
    setObstacleHit(false);
    setTapCount(0);
    firstTapTime.current = null;

    // Animate obstacle coming
    const animation = Animated.timing(obstacleX, {
      toValue: OBSTACLE_END_X,
      duration: OBSTACLE_SPEED,
      useNativeDriver: false,
    });

    obstacleAnimationRef.current = animation;
    
    animation.start((finished) => {
      if (finished && showObstacle && !hasJumped) {
        // Obstacle hit - didn't jump in time
        setObstacleHit(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Speech.speak('Obstacle se takra gaya! Double tap se jump karna tha!', { rate: 0.8 });
        
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            setShowCharacter(false);
            setShowObstacle(false);
            setHasJumped(false);
            setObstacleHit(false);
            characterY.setValue(CHARACTER_START_Y);
            characterScale.setValue(1);
            obstacleX.setValue(OBSTACLE_START_X);
          } else {
            endGame();
          }
        }, 1500);
      }
    });

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak('Rock aa raha hai! Double tap se jump karo!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak('Rock aa raha hai! Double tap se jump karo!', { rate: 0.8 });
    }
  }, [done, showCharacter, obstacleX, round, characterY, characterScale, showObstacle, hasJumped]);

  const showCharacterObject = useCallback(() => {
    setShowCharacter(true);
    setHasJumped(false);
    setObstacleHit(false);
    setTapCount(0);
    firstTapTime.current = null;
    characterY.setValue(CHARACTER_START_Y);
    characterScale.setValue(1);
    obstacleX.setValue(OBSTACLE_START_X);
    
    Animated.spring(characterScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    // Start obstacle after a delay
    setTimeout(() => {
      startObstacle();
    }, 1000);
  }, [characterScale, characterY, obstacleX, startObstacle]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showCharacterObject();
    }, 500);
  }, [done, showCharacterObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowCharacter(false);
    setShowObstacle(false);

    if (obstacleAnimationRef.current) {
      obstacleAnimationRef.current.stop();
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'obstacle-jump',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['planning-skills', 'reaction-time', 'double-tap'],
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
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (obstacleAnimationRef.current) {
        obstacleAnimationRef.current.stop();
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Obstacle Jump"
        emoji="🪨"
        description="Rock aaye → double tap se jump karo! Obstacle se bachne ke liye planning karo!"
        skills={['Planning skills', 'Reaction time', 'Double tap']}
        suitableFor="Children learning planning skills and obstacle avoidance"
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
            setShowCharacter(false);
            setShowObstacle(false);
            setHasJumped(false);
            setObstacleHit(false);
            setTapCount(0);
            characterY.setValue(CHARACTER_START_Y);
            characterScale.setValue(1);
            obstacleX.setValue(OBSTACLE_START_X);
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
        <Text style={styles.title}>Obstacle Jump</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🪨 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showObstacle ? 'Rock aa raha hai! Double tap se jump karo!' : 'Get ready...'}
        </Text>
        {tapCount > 0 && (
          <Text style={styles.tapIndicator}>
            Tap: {tapCount}/2
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showCharacter && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleTap}
            style={styles.tapArea}
          >
            <Animated.View
              style={[
                styles.characterContainer,
                {
                  top: characterY,
                  transform: [{ scale: characterScale }],
                },
              ]}
            >
              <Text style={styles.characterEmoji}>🚶</Text>
              {showObstacle && (
                <Text style={styles.jumpLabel}>DOUBLE TAP</Text>
              )}
            </Animated.View>

            {showObstacle && (
              <Animated.View
                style={[
                  styles.obstacleContainer,
                  {
                    left: obstacleX,
                    top: OBSTACLE_Y,
                    opacity: obstacleHit ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={styles.obstacleEmoji}>🪨</Text>
              </Animated.View>
            )}
          </TouchableOpacity>
        )}

        {!showCharacter && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Planning skills • Reaction time • Double tap
        </Text>
        <Text style={styles.footerSubtext}>
          Watch for obstacles and double tap to jump over them!
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
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  tapIndicator: {
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
    overflow: 'hidden',
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  characterContainer: {
    position: 'absolute',
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -60,
  },
  characterEmoji: {
    fontSize: 100,
    marginBottom: 8,
  },
  jumpLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  obstacleContainer: {
    position: 'absolute',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -50,
    marginTop: -50,
  },
  obstacleEmoji: {
    fontSize: 80,
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

export default ObstacleJumpGame;

