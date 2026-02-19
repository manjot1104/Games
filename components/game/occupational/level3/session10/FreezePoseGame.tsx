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

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HOLD_TIME = 5000; // 5 seconds to hold pose
const POSE_DISPLAY_TIME = 2000; // Time to show pose before holding

type PoseType = 'arms-up' | 'one-leg' | 'star' | 'warrior' | 'tree';

const POSE_EMOJIS: Record<PoseType, string> = {
  'arms-up': '🙌',
  'one-leg': '🦵',
  'star': '⭐',
  'warrior': '⚔️',
  'tree': '🌳',
};

const FreezePoseGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPose, setShowPose] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseType>('arms-up');
  const [isHolding, setIsHolding] = useState(false);
  const [holdTime, setHoldTime] = useState(0);
  const [canHold, setCanHold] = useState(false);

  const poseScale = useRef(new Animated.Value(1)).current;
  const poseOpacity = useRef(new Animated.Value(0)).current;
  const timerOpacity = useRef(new Animated.Value(0)).current;
  const poseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const showPoseOnScreen = useCallback(() => {
    if (done) return;

    const poses: PoseType[] = ['arms-up', 'one-leg', 'star', 'warrior', 'tree'];
    const randomPose = poses[Math.floor(Math.random() * poses.length)];
    setCurrentPose(randomPose);
    
    setShowPose(true);
    setCanHold(false);
    setIsHolding(false);
    setHoldTime(0);
    poseOpacity.setValue(0);
    poseScale.setValue(0.5);
    timerOpacity.setValue(0);
    
    // Show pose animation
    Animated.parallel([
      Animated.spring(poseScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(poseOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    const poseName = randomPose === 'arms-up' ? 'arms up' : 
                    randomPose === 'one-leg' ? 'one leg' :
                    randomPose === 'star' ? 'star' :
                    randomPose === 'warrior' ? 'warrior' : 'tree';

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(`Get ready! ${poseName} pose!`, 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS(`Get ready! ${poseName} pose!`, 0.8, 'en-US' );
    }

    // After showing pose, allow holding
    poseTimeoutRef.current = setTimeout(() => {
      setCanHold(true);
      setIsHolding(true);
      Animated.timing(timerOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      speakTTS('Hold the pose!', 0.8, 'en-US' );

      // Start hold timer
      let timeElapsed = 0;
      const timerInterval = setInterval(() => {
        timeElapsed += 100;
        setHoldTime(timeElapsed);
        
        if (timeElapsed >= HOLD_TIME) {
          clearInterval(timerInterval);
          // Success!
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Perfect hold!', 0.9, 'en-US' );
          
          Animated.sequence([
            Animated.timing(poseScale, {
              toValue: 1.3,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(poseScale, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();

          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowPose(false);
              setIsHolding(false);
              poseOpacity.setValue(0);
              poseScale.setValue(1);
              timerOpacity.setValue(0);
            } else {
              endGame();
            }
          }, 1000);
        }
      }, 100);

      holdTimerRef.current = timerInterval as unknown as NodeJS.Timeout;
    }, POSE_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, poseScale, poseOpacity, timerOpacity, round]);

  const handleRelease = useCallback(() => {
    if (!isHolding || !canHold || done) return;

    setIsHolding(false);
    setCanHold(false);
    
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current as unknown as ReturnType<typeof setInterval>);
      holdTimerRef.current = null;
    }

    if (holdTime < HOLD_TIME) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      speakTTS('Hold longer!', 0.8, 'en-US' );
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowPose(false);
          setHoldTime(0);
          poseOpacity.setValue(0);
          poseScale.setValue(1);
          timerOpacity.setValue(0);
        } else {
          endGame();
        }
      }, 1000);
    }
  }, [isHolding, canHold, done, holdTime, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showPoseOnScreen();
    }, 500);
  }, [done, showPoseOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPose(false);
    setIsHolding(false);

    if (poseTimeoutRef.current) {
      clearTimeout(poseTimeoutRef.current);
    }
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current as unknown as ReturnType<typeof setInterval>);
    }

    try {
      await logGameAndAward({
        type: 'freeze-pose',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['balance', 'strength', 'posture'],
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
      if (poseTimeoutRef.current) {
        clearTimeout(poseTimeoutRef.current);
      }
      if (holdTimerRef.current) {
        clearInterval(holdTimerRef.current as unknown as ReturnType<typeof setInterval>);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Freeze Pose"
        emoji="🧊"
        description="Hold the pose until the timer finishes!"
        skills={['Balance', 'Strength']}
        suitableFor="Children learning balance and strength through posture holding"
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
            setShowPose(false);
            setIsHolding(false);
            setHoldTime(0);
            poseOpacity.setValue(0);
            poseScale.setValue(1);
            timerOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const progress = (holdTime / HOLD_TIME) * 100;
  const timeRemaining = Math.max(0, (HOLD_TIME - holdTime) / 1000);

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
        <Text style={styles.title}>Freeze Pose</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🧊 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canHold ? 'Hold the pose!' : 'Get ready...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPose && (
          <View style={styles.poseContainer}>
            <Animated.View
              style={[
                styles.poseDisplay,
                {
                  transform: [{ scale: poseScale }],
                  opacity: poseOpacity,
                },
              ]}
            >
              <Text style={styles.poseEmoji}>{POSE_EMOJIS[currentPose]}</Text>
              <Text style={styles.poseLabel}>{currentPose.toUpperCase().replace('-', ' ')}</Text>
            </Animated.View>

            {isHolding && (
              <Animated.View
                style={[
                  styles.timerContainer,
                  {
                    opacity: timerOpacity,
                  },
                ]}
              >
                <Text style={styles.timerText}>
                  {timeRemaining.toFixed(1)}s
                </Text>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.holdInstruction}>HOLD!</Text>
              </Animated.View>
            )}
          </View>
        )}

        {!showPose && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Balance • Strength
        </Text>
        <Text style={styles.footerSubtext}>
          Hold the pose steady until the timer finishes!
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
  poseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  poseDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  poseEmoji: {
    fontSize: 150,
    marginBottom: 10,
  },
  poseLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
  },
  timerContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  timerText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#10B981',
    marginBottom: 10,
  },
  progressBarContainer: {
    width: 200,
    height: 20,
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 10,
  },
  holdInstruction: {
    fontSize: 28,
    fontWeight: '800',
    color: '#10B981',
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

export default FreezePoseGame;
