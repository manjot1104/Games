import { logGameAndAward, recordGame } from '@/utils/api';
import { stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue
} from 'react-native-reanimated';
import { SparkleBurst } from './FX';
import ResultCard from './ResultCard';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const RESET_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const LINE_WIDTH = 12;
const TOLERANCE = 35;

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const TraceStraightLineGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playReset = useSoundEffect(RESET_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [progress, setProgress] = useState(0);
  const [tracePath, setTracePath] = useState<Array<{ x: number; y: number }>>([]);

  const fingerX = useSharedValue(15);
  const fingerY = useSharedValue(50);
  const fingerScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);
  const endX = useSharedValue(85);
  const endY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        const timestamp = new Date().toISOString();
        setLogTimestamp(timestamp);
        await logGameAndAward({
          gameId: 'trace-straight-line',
          therapyId: 'occupational',
          levelNumber: 2,
          sessionNumber: 1,
          score: finalScore,
          totalRounds: total,
          accuracy,
          xp,
          timestamp,
        });
        await recordGame({
          gameId: 'trace-straight-line',
          therapyId: 'occupational',
          levelNumber: 2,
          sessionNumber: 1,
          score: finalScore,
          totalRounds: total,
          accuracy,
          xp,
          timestamp,
        });
      } catch (error) {
        console.error('Failed to log game:', error);
      }
    },
    [],
  );

  const checkIfOnLine = useCallback((x: number, y: number): boolean => {
    if (isHorizontal) {
      const lineY = startY.value;
      return Math.abs(y - lineY) < TOLERANCE && x >= Math.min(startX.value, endX.value) && x <= Math.max(startX.value, endX.value);
    } else {
      const lineX = startX.value;
      return Math.abs(x - lineX) < TOLERANCE && y >= Math.min(startY.value, endY.value) && y <= Math.max(startY.value, endY.value);
    }
  }, [isHorizontal]);

  const checkProgress = useCallback((x: number, y: number): number => {
    if (isHorizontal) {
      const totalDist = Math.abs(endX.value - startX.value);
      const currentDist = Math.abs(x - startX.value);
      return Math.min(100, Math.max(0, (currentDist / totalDist) * 100));
    } else {
      const totalDist = Math.abs(endY.value - startY.value);
      const currentDist = Math.abs(y - startY.value);
      return Math.min(100, Math.max(0, (currentDist / totalDist) * 100));
    }
  }, [isHorizontal]);

  const panGesture = Gesture.Pan()
    .onStart((evt) => {
      if (!roundActive || done) return;
      const { x, y } = evt;
      const screenX = (x / screenWidth.current) * 100;
      const screenY = (y / screenHeight.current) * 100;

      if (checkIfOnLine(screenX, screenY)) {
        setIsDragging(true);
        fingerX.value = screenX;
        fingerY.value = screenY;
        setTracePath([{ x: screenX, y: screenY }]);
        setProgress(checkProgress(screenX, screenY));
      }
    })
    .onUpdate((evt) => {
      if (!isDragging || !roundActive || done) return;
      const { x, y } = evt;
      const screenX = (x / screenWidth.current) * 100;
      const screenY = (y / screenHeight.current) * 100;

      if (checkIfOnLine(screenX, screenY)) {
        fingerX.value = screenX;
        fingerY.value = screenY;
        setTracePath((prev) => [...prev, { x: screenX, y: screenY }]);
        const newProgress = checkProgress(screenX, screenY);
        setProgress(newProgress);

        if (newProgress >= 95) {
          setScore((s) => s + 1);
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          sparkleX.value = endX.value;
          sparkleY.value = endY.value;

          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setIsHorizontal(Math.random() > 0.5);
              setTracePath([]);
              setProgress(0);
              fingerX.value = startX.value;
              fingerY.value = startY.value;
              playReset();
            } else {
              endGame(score + 1);
            }
          }, 1000);
        }
      } else {
        setIsDragging(false);
        setTracePath([]);
        setProgress(0);
        fingerX.value = startX.value;
        fingerY.value = startY.value;
      }
    })
    .onEnd(() => {
      setIsDragging(false);
      if (progress < 95) {
        setTracePath([]);
        setProgress(0);
        fingerX.value = startX.value;
        fingerY.value = startY.value;
      }
    });

  useEffect(() => {
    if (round === 1 && !done) {
      speakTTS('Trace the straight line from start to end!', 0.9 );
    }
  }, [round, done]);

  useEffect(() => {
    if (isHorizontal) {
      startX.value = 15;
      startY.value = 50;
      endX.value = 85;
      endY.value = 50;
    } else {
      startX.value = 50;
      startY.value = 20;
      endX.value = 50;
      endY.value = 80;
    }
    fingerX.value = startX.value;
    fingerY.value = startY.value;
    setTracePath([]);
    setProgress(0);
  }, [isHorizontal, round]);

  const fingerStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: `${fingerX.value}%`,
    top: `${fingerY.value}%`,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    transform: [{ scale: fingerScale.value }],
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  }));

  const lineStyle: any = {
    position: 'absolute',
    backgroundColor: '#E5E7EB',
    borderRadius: LINE_WIDTH / 2,
  };

  if (isHorizontal) {
    lineStyle.left = `${startX.value}%`;
    lineStyle.top = `${startY.value - LINE_WIDTH / 2}%`;
    lineStyle.width = `${endX.value - startX.value}%`;
    lineStyle.height = LINE_WIDTH;
  } else {
    lineStyle.left = `${startX.value - LINE_WIDTH / 2}%`;
    lineStyle.top = `${startY.value}%`;
    lineStyle.width = LINE_WIDTH;
    lineStyle.height = `${endY.value - startY.value}%`;
  }

  const traceStyle: any = {
    position: 'absolute',
    backgroundColor: '#8B5CF6',
    borderRadius: LINE_WIDTH / 2,
  };

  if (isHorizontal && tracePath.length > 0) {
    const minX = Math.min(...tracePath.map(p => p.x));
    const maxX = Math.max(...tracePath.map(p => p.x));
    traceStyle.left = `${minX}%`;
    traceStyle.top = `${startY.value - LINE_WIDTH / 2}%`;
    traceStyle.width = `${maxX - minX}%`;
    traceStyle.height = LINE_WIDTH;
  } else if (!isHorizontal && tracePath.length > 0) {
    const minY = Math.min(...tracePath.map(p => p.y));
    const maxY = Math.max(...tracePath.map(p => p.y));
    traceStyle.left = `${startX.value - LINE_WIDTH / 2}%`;
    traceStyle.top = `${minY}%`;
    traceStyle.width = LINE_WIDTH;
    traceStyle.height = `${maxY - minY}%`;
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xp={finalStats.xp}
          onBack={onBack}
          onRetry={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setRoundActive(true);
            setIsHorizontal(Math.random() > 0.5);
            setTracePath([]);
            setProgress(0);
            fingerX.value = startX.value;
            fingerY.value = startY.value;
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            stopAllSpeech();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Trace Straight Line</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.gameArea} onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}>
          <GestureDetector gesture={panGesture}>
            <View style={styles.touchArea}>
              <View style={[styles.startDot, { left: `${startX.value}%`, top: `${startY.value}%` }]} />
              <View style={[styles.endDot, { left: `${endX.value}%`, top: `${endY.value}%` }]} />
              <View style={lineStyle} />
              {tracePath.length > 0 && <View style={traceStyle} />}
              <Animated.View style={fingerStyle} />
              <SparkleBurst x={sparkleX} y={sparkleY} />
            </View>
          </GestureDetector>
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            {isHorizontal ? 'Trace horizontally from left to right!' : 'Trace vertically from top to bottom!'}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 8,
  },
  backText: {
    fontSize: 16,
    color: '#3B82F6',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 14,
    color: '#6B7280',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  gameArea: {
    width: '100%',
    height: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  touchArea: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  startDot: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  endDot: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 4,
  },
  instructions: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  instructionText: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
  },
});

export default TraceStraightLineGame;


