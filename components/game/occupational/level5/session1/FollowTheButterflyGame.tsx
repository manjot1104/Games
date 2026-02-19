import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTERFLY_SIZE = 60;
const FOLLOW_DISTANCE = 100; // Distance to maintain for success
const FOLLOW_TIME = 3000; // 3 seconds of following

const FollowTheButterflyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const butterflyX = useSharedValue(SCREEN_WIDTH * 0.5);
  const butterflyY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const fingerX = useSharedValue(SCREEN_WIDTH * 0.5);
  const fingerY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const followTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isFollowingRef = useRef(false);
  const followStartTimeRef = useRef<number | null>(null);

  const moveButterfly = useCallback(() => {
    const move = () => {
      'worklet';
      // Smooth circular/curved movement
      const time = Date.now() / 1000;
      const radius = 150;
      const centerX = screenWidth.current * 0.5;
      const centerY = screenHeight.current * 0.5;
      
      butterflyX.value = centerX + Math.sin(time * 0.5) * radius;
      butterflyY.value = centerY + Math.cos(time * 0.5) * radius;
    };

    const interval = setInterval(() => {
      move();
    }, 16); // ~60fps

    animationRef.current = interval as unknown as number;
  }, []);

  const checkFollowDistance = useCallback(() => {
    const check = () => {
      if (done) return;
      
      const distance = Math.sqrt(
        Math.pow(fingerX.value - butterflyX.value, 2) + Math.pow(fingerY.value - butterflyY.value, 2)
      );

      if (distance <= FOLLOW_DISTANCE) {
        if (!isFollowingRef.current) {
          isFollowingRef.current = true;
          followStartTimeRef.current = Date.now();
        } else {
          const followDuration = Date.now() - (followStartTimeRef.current || 0);
          if (followDuration >= FOLLOW_TIME) {
            // Success!
            setScore((s) => {
              const newScore = s + 1;
              if (newScore >= TOTAL_ROUNDS) {
                setTimeout(() => {
                  endGame(newScore);
                }, 1000);
              } else {
                setTimeout(() => {
                  setRound((r) => r + 1);
                  resetButterfly();
                }, 1500);
              }
              return newScore;
            });

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            speakTTS('Great following!', 0.9, 'en-US');
            
            isFollowingRef.current = false;
            followStartTimeRef.current = null;
          }
        }
      } else {
        isFollowingRef.current = false;
        followStartTimeRef.current = null;
      }
    };

    const interval = setInterval(check, 100);
    followTimerRef.current = interval;
  }, [done, fingerX, fingerY, butterflyX, butterflyY]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (done) return;
      fingerX.value = Math.max(0, Math.min(screenWidth.current, e.x));
      fingerY.value = Math.max(0, Math.min(screenHeight.current, e.y));
    });

  const resetButterfly = useCallback(() => {
    butterflyX.value = withSpring(Math.random() * (screenWidth.current - BUTTERFLY_SIZE) + BUTTERFLY_SIZE / 2);
    butterflyY.value = withSpring(Math.random() * (screenHeight.current - BUTTERFLY_SIZE - 200) + BUTTERFLY_SIZE / 2 + 100);
    isFollowingRef.current = false;
    followStartTimeRef.current = null;
  }, [butterflyX, butterflyY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
    if (followTimerRef.current) {
      clearInterval(followTimerRef.current);
      followTimerRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'follow-the-butterfly',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['smooth-eye-movement', 'tracking', 'coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      resetButterfly();
      setTimeout(() => {
        moveButterfly();
        checkFollowDistance();
        speakTTS('Follow the butterfly with your finger!', 0.8, 'en-US');
      }, 500);
    }
  }, [showInfo, round, done, resetButterfly, moveButterfly, checkFollowDistance]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
      if (followTimerRef.current) {
        clearInterval(followTimerRef.current);
      }
    };
  }, []);

  const butterflyStyle = useAnimatedStyle(() => ({
    left: butterflyX.value - BUTTERFLY_SIZE / 2,
    top: butterflyY.value - BUTTERFLY_SIZE / 2,
  }));

  const fingerStyle = useAnimatedStyle(() => ({
    left: fingerX.value - 20,
    top: fingerY.value - 20,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Follow the Butterfly"
        emoji="🦋"
        description="Follow the butterfly with your finger for 3 seconds!"
        skills={['Smooth eye movement', 'Tracking']}
        suitableFor="Children learning smooth eye movement and tracking"
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
            resetButterfly();
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
        <Text style={styles.title}>Follow the Butterfly</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🦋 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Keep your finger close to the butterfly for 3 seconds!
        </Text>
        {isFollowingRef.current && (
          <Text style={styles.followingText}>
            Following... {((Date.now() - (followStartTimeRef.current || 0)) / 1000).toFixed(1)}s
          </Text>
        )}
      </View>

      <GestureDetector gesture={panGesture}>
        <View
          style={styles.gameArea}
          onLayout={(e) => {
            screenWidth.current = e.nativeEvent.layout.width;
            screenHeight.current = e.nativeEvent.layout.height;
          }}
        >
          <Animated.View style={[styles.butterfly, butterflyStyle]}>
            <Text style={styles.butterflyEmoji}>🦋</Text>
          </Animated.View>
          <Animated.View style={[styles.finger, fingerStyle]}>
            <Text style={styles.fingerEmoji}>👆</Text>
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Smooth eye movement • Tracking
        </Text>
        <Text style={styles.footerSubtext}>
          Follow the butterfly with your finger!
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
    marginBottom: 4,
  },
  followingText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  butterfly: {
    position: 'absolute',
    width: BUTTERFLY_SIZE,
    height: BUTTERFLY_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  butterflyEmoji: {
    fontSize: 50,
  },
  finger: {
    position: 'absolute',
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  fingerEmoji: {
    fontSize: 30,
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

export default FollowTheButterflyGame;
