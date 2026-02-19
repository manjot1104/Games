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
const POSE_DISPLAY_TIME = 3000; // Time to show pose (ms)
const RESPONSE_TIME = 4000; // Time to copy pose (ms)

type PoseType = 'hands-up' | 'hands-down' | 'hands-left' | 'hands-right' | 'clap';

const POSE_EMOJIS: Record<PoseType, string> = {
  'hands-up': '🙌',
  'hands-down': '👇',
  'hands-left': '👈',
  'hands-right': '👉',
  'clap': '👏',
};

const CopyPoseGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPose, setShowPose] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseType>('hands-up');
  const [canCopy, setCanCopy] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const poseScale = useRef(new Animated.Value(1)).current;
  const poseOpacity = useRef(new Animated.Value(0)).current;
  const poseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showPoseOnScreen = useCallback(() => {
    if (done) return;

    // Random pose
    const poses: PoseType[] = ['hands-up', 'hands-down', 'hands-left', 'hands-right', 'clap'];
    const randomPose = poses[Math.floor(Math.random() * poses.length)];
    setCurrentPose(randomPose);
    
    setShowPose(true);
    setCanCopy(false);
    setHasCopied(false);
    poseOpacity.setValue(0);
    poseScale.setValue(0.5);
    
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

    // After showing pose, allow copying
    poseTimeoutRef.current = setTimeout(() => {
      setCanCopy(true);
      const poseName = randomPose === 'hands-up' ? 'hands up' : 
                      randomPose === 'hands-down' ? 'hands down' :
                      randomPose === 'hands-left' ? 'hands left' :
                      randomPose === 'hands-right' ? 'hands right' : 'clap';
      
      if (Platform.OS === 'web') {
        setTimeout(() => {
          speakTTS(`Copy this pose! ${poseName}!`, 0.8, 'en-US' );
        }, 300);
      } else {
        speakTTS(`Copy this pose! ${poseName}!`, 0.8, 'en-US' );
      }

      // Close copy window
      copyTimeoutRef.current = setTimeout(() => {
        setCanCopy(false);
        if (!hasCopied) {
          // Didn't copy in time
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Copy the pose!', 0.8, 'en-US' );
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowPose(false);
              poseOpacity.setValue(0);
              poseScale.setValue(1);
            } else {
              endGame();
            }
          }, 1000);
        }
      }, RESPONSE_TIME) as unknown as NodeJS.Timeout;
    }, POSE_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, poseScale, poseOpacity, round, hasCopied]);

  const handleCopy = useCallback(() => {
    if (!canCopy || done || !showPose || hasCopied) return;

    setHasCopied(true);
    setScore((s) => s + 1);
    
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect copy!', 0.9, 'en-US' );
    
    // Success animation
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
        poseOpacity.setValue(0);
        poseScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [canCopy, done, showPose, hasCopied, poseScale, round]);

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

    if (poseTimeoutRef.current) {
      clearTimeout(poseTimeoutRef.current);
    }
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'copy-pose',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['observation', 'motor-imitation'],
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
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Copy Pose"
        emoji="👤"
        description="Watch the pose on screen and copy it!"
        skills={['Observation', 'Motor imitation']}
        suitableFor="Children learning observation and motor imitation skills"
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
            setShowPose(false);
            setHasCopied(false);
            poseOpacity.setValue(0);
            poseScale.setValue(1);
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
        <Text style={styles.title}>Copy Pose</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👤 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canCopy ? 'Copy this pose!' : 'Watch the pose...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPose && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCopy}
            style={styles.tapArea}
            disabled={!canCopy}
          >
            <Animated.View
              style={[
                styles.poseContainer,
                {
                  transform: [{ scale: poseScale }],
                  opacity: poseOpacity,
                },
              ]}
            >
              <Text style={styles.poseEmoji}>{POSE_EMOJIS[currentPose]}</Text>
              {canCopy && (
                <Text style={styles.copyLabel}>COPY ME!</Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        )}

        {!showPose && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Observation • Motor imitation
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the pose and copy it with your body!
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
  poseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  poseEmoji: {
    fontSize: 150,
    marginBottom: 20,
  },
  copyLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
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

export default CopyPoseGame;
