import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const WIDE_PATH_WIDTH = 60;
const THIN_PATH_WIDTH = 20;
const TOLERANCE = 15;

const BigPathTraceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isWidePath, setIsWidePath] = useState(true);
  const [progress, setProgress] = useState(0);
  const [tracePath, setTracePath] = useState<Array<{ x: number; y: number }>>([]);
  const [isTracing, setIsTracing] = useState(false);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);
  const endX = useSharedValue(85);
  const endY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const pathWidth = isWidePath ? WIDE_PATH_WIDTH : THIN_PATH_WIDTH;

  // Define endGame before it's used in panGesture
  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsTracing(false);
    setTracePath([]);
    setProgress(0);

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'big-path-trace',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
      await recordGame({
        gameId: 'big-path-trace',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score]);

  // Start new round
  useEffect(() => {
    if (done) return;
    const wide = Math.random() > 0.5;
    setIsWidePath(wide);
    setProgress(0);
    setTracePath([]);
    setIsTracing(false);
    if (round === 1) {
      speakTTS('Trace wide road vs thin road!', 0.9 );
    } else {
      speakTTS(wide ? 'Trace the wide road!' : 'Trace the thin road!', 0.9 );
    }
  }, [round, done]);

  useEffect(() => {
    return () => {
      // Cleanup: Stop all sounds and speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
    };
  }, []);

  const checkIfOnPath = useCallback(
    (x: number, y: number): boolean => {
      const lineY = startY.value;
      const distance = Math.abs(y - lineY);
      return distance < pathWidth / 2 + TOLERANCE && x >= Math.min(startX.value, endX.value) && x <= Math.max(startX.value, endX.value);
    },
    [pathWidth],
  );

  const checkProgress = useCallback((x: number): number => {
    const totalDist = Math.abs(endX.value - startX.value);
    const currentDist = Math.abs(x - startX.value);
    return Math.min(100, Math.max(0, (currentDist / totalDist) * 100));
  }, []);

  const panGesture = Gesture.Pan()
    .onStart((evt) => {
      if (done) return;
      const { x, y } = evt;
      const screenX = (x / screenWidth.current) * 100;
      const screenY = (y / screenHeight.current) * 100;

      if (checkIfOnPath(screenX, screenY)) {
        setIsTracing(true);
        setTracePath([{ x: screenX, y: screenY }]);
        setProgress(checkProgress(screenX));
      }
    })
    .onUpdate((evt) => {
      if (!isTracing || done) return;
      const { x, y } = evt;
      const screenX = (x / screenWidth.current) * 100;
      const screenY = (y / screenHeight.current) * 100;

      if (checkIfOnPath(screenX, screenY)) {
        setTracePath((prev) => [...prev, { x: screenX, y: screenY }]);
        const newProgress = checkProgress(screenX);
        setProgress(newProgress);

        if (newProgress >= 95) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          sparkleX.setValue(endX.value);
          sparkleY.setValue(endY.value);

          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
            } else {
              endGame();
            }
          }, 1000);
        }
      } else {
        setIsTracing(false);
        setTracePath([]);
        setProgress(0);
      }
    })
    .onEnd(() => {
      if (progress < 95) {
        setIsTracing(false);
        setTracePath([]);
        setProgress(0);
      }
    });

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
            setProgress(0);
            setTracePath([]);
            setIsTracing(false);
          }}
        />
      </SafeAreaView>
    );
  }

  const pathStyle: any = {
    position: 'absolute',
    left: `${startX.value}%`,
    top: `${startY.value - pathWidth / 2}%`,
    width: `${endX.value - startX.value}%`,
    height: pathWidth,
    backgroundColor: '#E5E7EB',
    borderRadius: pathWidth / 2,
  };

  const traceStyle: any = {
    position: 'absolute',
    backgroundColor: '#8B5CF6',
    borderRadius: pathWidth / 2,
  };

  if (tracePath.length > 0) {
    const minX = Math.min(...tracePath.map((p) => p.x));
    const maxX = Math.max(...tracePath.map((p) => p.x));
    traceStyle.left = `${minX}%`;
    traceStyle.top = `${startY.value - pathWidth / 2}%`;
    traceStyle.width = `${maxX - minX}%`;
    traceStyle.height = pathWidth;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            try {
              stopTTS();
            } catch (e) {
              // Ignore errors
            }
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Big Path Trace</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {isWidePath ? '🛤️ Trace the WIDE road!' : '🛤️ Trace the THIN road!'}
          </Text>

          <View
            style={styles.touchArea}
            onLayout={(e) => {
              screenWidth.current = e.nativeEvent.layout.width;
              screenHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <GestureDetector gesture={panGesture}>
              <Animated.View style={styles.touchArea}>
                <View style={[styles.startDot, { left: `${startX.value}%`, top: `${startY.value}%` }]} />
                <View style={[styles.endDot, { left: `${endX.value}%`, top: `${endY.value}%` }]} />
                <View style={pathStyle} />
                {tracePath.length > 0 && <View style={traceStyle} />}
                <SparkleBurst x={sparkleX} y={sparkleY} />
              </Animated.View>
            </GestureDetector>
          </View>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </View>
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
  content: {
    flex: 1,
    padding: 16,
  },
  gameArea: {
    flex: 1,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 18,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },
  touchArea: {
    width: '100%',
    height: 400,
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
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
    zIndex: 10,
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
    zIndex: 10,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 4,
  },
});

export default BigPathTraceGame;

