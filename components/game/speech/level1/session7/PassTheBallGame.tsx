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
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTurns?: number;
};

const BALL_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;
const TURN_DELAY_MS = 1500;

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

export const PassTheBallGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTurns = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [turns, setTurns] = useState(0);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTurns: number;
    turnsCompleted: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [isYourTurn, setIsYourTurn] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [ballSide, setBallSide] = useState<'system' | 'child' | 'moving'>('system');
  const [canTap, setCanTap] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const ballX = useRef(new Animated.Value(0)).current;
  const ballScale = useRef(new Animated.Value(1)).current;
  const ballRotation = useRef(new Animated.Value(0)).current;
  const statusCircleScale = useRef(new Animated.Value(0)).current;
  const statusCircleOpacity = useRef(new Animated.Value(0)).current;
  const statusTextOpacity = useRef(new Animated.Value(0)).current;

  const startRound = useCallback(() => {
    if (turns >= requiredTurns) {
      finishGame();
      return;
    }

    // Reset state
    setIsYourTurn(false);
    setIsWaiting(false);
    setCanTap(false);
    setBallSide('system');
    
    // Reset animations - start from right side
    const startX = SCREEN_WIDTH * 0.85 - BALL_SIZE / 2;
    ballX.setValue(startX);
    ballScale.setValue(1);
    statusCircleScale.setValue(0);
    statusCircleOpacity.setValue(0);
    statusTextOpacity.setValue(0);

    // Wait a moment, then show WAIT and roll ball to child
    setTimeout(() => {
      console.log('Starting ball roll to child');
      setIsWaiting(true);
      setBallSide('moving');
      
      // Show WAIT indicator (yellow)
      Animated.parallel([
        Animated.spring(statusCircleScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(statusCircleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(statusTextOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait...');

      // Roll ball to child - adjust for ball center
      const targetX = SCREEN_WIDTH * 0.15 - BALL_SIZE / 2;
      
      // Start rotation animation separately (will loop indefinitely)
      Animated.loop(
        Animated.timing(ballRotation, {
          toValue: 1,
          duration: 400,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
      
      // Roll ball to child - this animation will complete
      Animated.timing(ballX, {
        toValue: targetX,
        duration: 800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        console.log('Ball arrived at child side');
        // Ball arrived at child side
        setIsWaiting(false);
        setIsYourTurn(true);
        setBallSide('child');
        setCanTap(true);
        
        // Hide WAIT, show YOUR TURN (green)
        Animated.parallel([
          Animated.timing(statusCircleOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(statusTextOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Show YOUR TURN
          Animated.parallel([
            Animated.spring(statusCircleScale, {
              toValue: 1,
              tension: 50,
              friction: 7,
              useNativeDriver: true,
            }),
            Animated.timing(statusCircleOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(statusTextOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start();
        });

        speak('Your turn!');
      });
    }, 500);
  }, [turns, requiredTurns, SCREEN_WIDTH]);

  const handleBallTap = useCallback(() => {
    if (!canTap || !isYourTurn || ballSide !== 'child') return;

    setCanTap(false);
    setIsYourTurn(false);
    setTurns(prev => prev + 1);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Ball bounce animation
    Animated.sequence([
      Animated.timing(ballScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(ballScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Hide YOUR TURN indicator
    Animated.parallel([
      Animated.timing(statusCircleOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(statusTextOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setTimeout(() => {
      setShowRoundSuccess(false);
    }, 2500);

    // Roll ball away to system side
    setTimeout(() => {
      setBallSide('moving');
      
      ballRotation.stopAnimation();
      ballRotation.setValue(0);
      
      Animated.timing(ballX, {
        toValue: SCREEN_WIDTH * 0.85,
        duration: 800,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setBallSide('system');
        
        // Wait, then start next round
        setTimeout(() => {
          startRound();
        }, TURN_DELAY_MS);
      });
    }, 300);
  }, [canTap, isYourTurn, ballSide, SCREEN_WIDTH, startRound]);

  const finishGame = useCallback(async () => {
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const accuracy = 100;
    const xp = turns * 20;

    setFinalStats({
      totalTurns: requiredTurns,
      turnsCompleted: turns,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'pass-the-ball',
        correct: turns,
        total: requiredTurns,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['turn-taking', 'waiting', 'impulse-control', 'alternating-roles'],
        meta: {
          turnsCompleted: turns,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [turns, requiredTurns, onComplete]);

  useEffect(() => {
    // Initialize ball position - adjust for ball center
    const startX = SCREEN_WIDTH * 0.85 - BALL_SIZE / 2;
    ballX.setValue(startX);
    // Give clear instructions before starting
    speak('Let\'s play pass the ball! When the ball comes to you, tap it to pass it back. Wait when it\'s not your turn!');
    setTimeout(() => {
      startRound();
    }, 4000);
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.turnsCompleted}
        total={finalStats.totalTurns}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.xpAwarded}
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

  const rotation = ballRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const centerY = SCREEN_HEIGHT * 0.5;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Pass the Ball</Text>
            <Text style={styles.subtitle}>Take turns! Tap when its your turn.</Text>
          </View>
        </View>

        <View style={styles.playArea} pointerEvents="box-none">
          {/* Status Indicator */}
          <View style={styles.statusContainer}>
            <Animated.View
              style={[
                styles.statusCircle,
                {
                  backgroundColor: isYourTurn ? '#22C55E' : '#FCD34D',
                  transform: [{ scale: statusCircleScale }],
                  opacity: statusCircleOpacity,
                },
              ]}
            />
            <Animated.Text
              style={[
                styles.statusText,
                {
                  opacity: statusTextOpacity,
                  color: isYourTurn ? '#16A34A' : '#D97706',
                },
              ]}
            >
              {isYourTurn ? 'YOUR TURN' : isWaiting ? 'WAIT' : ''}
            </Animated.Text>
          </View>

          {/* Ball */}
          <Animated.View
            style={[
              styles.ballWrapper,
                {
                transform: [
                  { translateX: ballX },
                  { translateY: centerY },
                ],
              },
            ]}
          >
            <Pressable
              onPress={handleBallTap}
              disabled={!canTap}
              style={styles.ballPressable}
            >
              <Animated.View
                style={[
                  styles.ball,
                  {
                    transform: [
                      { scale: ballScale },
                      { rotate: rotation },
                    ],
                  },
                ]}
              >
                <LinearGradient
                  colors={['#EF4444', '#DC2626']}
                  style={styles.ballGradient}
                >
                  <Text style={styles.ballEmoji}>⚽</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          </Animated.View>

          {/* Progress */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              Turn {turns + 1} • Completed: {turns} / {requiredTurns}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="repeat" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Turn-taking</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Waiting</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Impulse Control</Text>
          </View>
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
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  statusContainer: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 80,
  },
  statusCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    position: 'absolute',
  },
  statusText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 70,
    textAlign: 'center',
  },
  ballWrapper: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    left: 0,
    top: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  ballPressable: {
    width: BALL_SIZE,
    height: BALL_SIZE,
  },
  ball: {
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
  },
  ballGradient: {
    width: '100%',
    height: '100%',
    borderRadius: BALL_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  ballEmoji: {
    fontSize: 50,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  skillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
});
