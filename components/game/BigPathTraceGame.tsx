import { logGameAndAward } from '@/utils/api';
import { stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 8;
const WIDE_PATH_WIDTH = 40;
const THIN_PATH_WIDTH = 15;
const PATH_TOLERANCE = 20; // How far from center line is acceptable

type GamePhase = 'idle' | 'playing' | 'finished';
type PathType = 'wide' | 'thin';

export const BigPathTraceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [pathType, setPathType] = useState<PathType>('wide');
  const [tracePath, setTracePath] = useState<Array<{ x: number; y: number }>>([]);
  const [isTracing, setIsTracing] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const pathStartRef = useRef<{ x: number; y: number } | null>(null);
  const pathEndRef = useRef<{ x: number; y: number } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllSpeech();
    };
  }, []);

  // Generate a curved path
  const generatePath = useCallback((type: PathType) => {
    const width = type === 'wide' ? WIDE_PATH_WIDTH : THIN_PATH_WIDTH;
    // Simple curved path from left to right
    return {
      type,
      width,
      start: { x: 50, y: 300 },
      end: { x: 350, y: 300 },
      control: { x: 200, y: 200 }, // Curve point
    };
  }, []);

  const [currentPath, setCurrentPath] = useState(() => generatePath('wide'));

  const checkTraceAccuracy = useCallback((tracedPoints: Array<{ x: number; y: number }>) => {
    if (tracedPoints.length < 10) return false; // Need minimum points

    // Check if points stay within path bounds
    let inBounds = 0;
    const total = tracedPoints.length;

    tracedPoints.forEach((point) => {
      // Calculate distance from ideal path (simplified - using straight line for now)
      const idealY = currentPath.start.y;
      const distance = Math.abs(point.y - idealY);
      const maxDistance = currentPath.width / 2 + PATH_TOLERANCE;
      if (distance <= maxDistance) {
        inBounds += 1;
      }
    });

    const accuracy = inBounds / total;
    return accuracy >= 0.7; // 70% accuracy required
  }, [currentPath]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => phase === 'playing',
    onMoveShouldSetPanResponder: () => phase === 'playing',
    onPanResponderGrant: (evt) => {
      setIsTracing(true);
      const point = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
      setTracePath([point]);
      pathStartRef.current = point;
    },
    onPanResponderMove: (evt) => {
      if (isTracing) {
        const point = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        setTracePath((prev) => [...prev, point]);
      }
    },
    onPanResponderRelease: (evt) => {
      if (!isTracing) return;

      const point = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
      pathEndRef.current = point;
      setIsTracing(false);

      const isAccurate = checkTraceAccuracy([...tracePath, point]);
      if (isAccurate) {
        setCorrect((c) => c + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect trace!');
      } else {
        setWrong((w) => w + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Try again!');
      }

      // Reset and next round
      setTimeout(() => {
        setTracePath([]);
        if (round < TOTAL_ROUNDS) {
          const newType: PathType = Math.random() > 0.5 ? 'wide' : 'thin';
          setPathType(newType);
          setCurrentPath(generatePath(newType));
          setRound((r) => r + 1);
          speakTTS(newType === 'wide' ? 'Trace the WIDE road!' : 'Trace the THIN road!');
        } else {
          finishGame();
        }
      }, 1500);
    },
  });

  const startGame = () => {
    setPhase('playing');
    setRound(1);
    setCorrect(0);
    setWrong(0);
    const initialType: PathType = 'wide';
    setPathType(initialType);
    setCurrentPath(generatePath(initialType));
    setTracePath([]);
    speakTTS('Trace the path! Start from the left!');
  };

  const finishGame = async () => {
    setPhase('finished');
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 18;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'big-path-trace',
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['path-tracing', 'fine-motor-control', 'visual-motor-integration'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You traced all the paths perfectly!');
  };


  // Results screen
  if (phase === 'finished' && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => {
            stopAllSpeech();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.resultsContainer}>
          <Text style={styles.emoji}>🛤️</Text>
          <Text style={styles.title}>Path Trace Complete!</Text>
          <Text style={styles.subtitle}>You traced all the paths perfectly!</Text>

          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={finalStats.accuracy}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setPhase('idle');
              setFinalStats(null);
              setLogTimestamp(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Game screen
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.headerText}>Round {round} / {TOTAL_ROUNDS}</Text>
        <Text style={styles.scoreText}>Correct: {correct}</Text>
      </View>

      {phase === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>🛤️</Text>
          <Text style={styles.title}>Big Path Trace</Text>
          <Text style={styles.instructions}>
            Trace the path from start to end!{'\n'}
            Some paths are WIDE, some are THIN.{'\n'}
            Stay on the road!
          </Text>
          <TouchableOpacity style={styles.startButton} onPress={startGame}>
            <LinearGradient
              colors={['#8B5CF6', '#6366F1']}
              style={styles.startButtonGradient}
            >
              <Text style={styles.startButtonText}>Start Game</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <View style={styles.pathIndicator}>
            <Text style={styles.pathTypeText}>
              {pathType === 'wide' ? 'WIDE ROAD' : 'THIN ROAD'}
            </Text>
          </View>

          <View style={styles.pathContainer}>
            <View style={styles.pathBackground}>
              {/* Path outline */}
              <View
                style={[
                  styles.pathOutline,
                  {
                    width: currentPath.width,
                    height: 200,
                    left: currentPath.start.x - currentPath.width / 2,
                    top: currentPath.start.y - 100,
                  },
                ]}
              >
                <LinearGradient
                  colors={pathType === 'wide' ? ['#F59E0B', '#D97706'] : ['#6366F1', '#4F46E5']}
                  style={styles.pathGradient}
                />
              </View>

              {/* Start marker */}
              <View
                style={[
                  styles.startMarker,
                  {
                    left: currentPath.start.x - 15,
                    top: currentPath.start.y - 15,
                  },
                ]}
              >
                <Text style={styles.markerText}>START</Text>
              </View>

              {/* End marker */}
              <View
                style={[
                  styles.endMarker,
                  {
                    left: currentPath.end.x - 15,
                    top: currentPath.end.y - 15,
                  },
                ]}
              >
                <Text style={styles.markerText}>END</Text>
              </View>

              {/* Trace path overlay - simple dots */}
              {tracePath.map((point, index) => (
                <View
                  key={index}
                  style={[
                    styles.traceDot,
                    {
                      left: point.x - 3,
                      top: point.y - 3,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              Drag your finger along the {pathType === 'wide' ? 'WIDE' : 'THIN'} road from START to END
            </Text>
          </View>
        </View>
      )}
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
    left: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingTop: 80,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  startButton: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  startButtonGradient: {
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    padding: 24,
  },
  pathIndicator: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 3,
    borderColor: '#8B5CF6',
    alignItems: 'center',
  },
  pathTypeText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#8B5CF6',
    letterSpacing: 2,
  },
  pathContainer: {
    flex: 1,
    marginBottom: 24,
  },
  pathBackground: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    position: 'relative',
    overflow: 'hidden',
  },
  pathOutline: {
    position: 'absolute',
    borderRadius: 100,
    overflow: 'hidden',
  },
  pathGradient: {
    width: '100%',
    height: '100%',
  },
  startMarker: {
    position: 'absolute',
    width: 60,
    height: 30,
    backgroundColor: '#10B981',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#059669',
  },
  endMarker: {
    position: 'absolute',
    width: 60,
    height: 30,
    backgroundColor: '#EF4444',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#DC2626',
  },
  markerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  instructionBox: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  instructionText: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    fontWeight: '600',
  },
  traceDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  resultsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
});

