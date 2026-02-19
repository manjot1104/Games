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
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OBJECT_SIZE = 60;
const TOLERANCE = 50;
const ZIGZAG_WIDTH = 200;
const ZIGZAG_SPEED = 3;

const ZigZagFollowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const objectX = useSharedValue(SCREEN_WIDTH * 0.5);
  const objectY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const objectScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const zigzagPhase = useRef(0);
  const direction = useRef(1); // 1 for right, -1 for left

  const moveZigZag = useCallback(() => {
    const move = () => {
      'worklet';
      zigzagPhase.current += ZIGZAG_SPEED * direction.current;
      
      // Calculate zigzag pattern
      const centerY = screenHeight.current * 0.5;
      const amplitude = 150;
      const frequency = 0.01;
      
      objectX.value = zigzagPhase.current;
      objectY.value = centerY + Math.sin(zigzagPhase.current * frequency) * amplitude;
      
      // Reverse direction at edges
      if (objectX.value >= screenWidth.current - OBJECT_SIZE / 2) {
        direction.current = -1;
        zigzagPhase.current = screenWidth.current - OBJECT_SIZE / 2;
      } else if (objectX.value <= OBJECT_SIZE / 2) {
        direction.current = 1;
        zigzagPhase.current = OBJECT_SIZE / 2;
      }
    };

    const interval = setInterval(() => {
      move();
    }, 16); // ~60fps

    animationRef.current = interval as unknown as number;
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - objectX.value, 2) + Math.pow(tapY - objectY.value, 2)
    );

    if (distance <= TOLERANCE + OBJECT_SIZE / 2) {
      // Success!
      objectScale.value = withSpring(1.5, {}, () => {
        objectScale.value = withSpring(1);
      });

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            resetObject();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, objectX, objectY, objectScale]);

  const resetObject = useCallback(() => {
    // Start from left side
    zigzagPhase.current = OBJECT_SIZE / 2;
    direction.current = 1;
    objectX.value = OBJECT_SIZE / 2;
    objectY.value = screenHeight.current * 0.5;
  }, [objectX, objectY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'zigzag-follow',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reading-line-movement', 'visual-tracking', 'pattern-following'],
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
      resetObject();
      setTimeout(() => {
        moveZigZag();
        speakTTS('Follow the zigzag pattern!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, resetObject, moveZigZag]);

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
    };
  }, []);

  const objectStyle = useAnimatedStyle(() => ({
    left: objectX.value - OBJECT_SIZE / 2,
    top: objectY.value - OBJECT_SIZE / 2,
    transform: [{ scale: objectScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Zig-zag Follow"
        emoji="〰️"
        description="Follow and tap the object moving in a zigzag pattern!"
        skills={['Reading line movement prep', 'Visual tracking']}
        suitableFor="Children preparing for reading line movement"
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
            resetObject();
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
        <Text style={styles.title}>Zig-zag Follow</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 〰️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the object as it moves in zigzag!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        <Animated.View style={[styles.object, objectStyle]}>
          <Text style={styles.objectEmoji}>🔵</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Reading line movement prep • Visual tracking
        </Text>
        <Text style={styles.footerSubtext}>
          Follow the object moving in zigzag pattern!
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
    position: 'relative',
    marginVertical: 40,
  },
  object: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 40,
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

export default ZigZagFollowGame;
