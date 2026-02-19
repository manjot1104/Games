import { logGameAndAward } from '@/utils/api';
import { stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;
const STRETCH_THRESHOLD = 100; // Minimum distance increase for stretch
const PINCH_THRESHOLD = -80; // Maximum distance decrease for pinch

type GamePhase = 'idle' | 'playing' | 'finished';
type TargetAction = 'stretch' | 'pinch';

export const StretchVsPinchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [targetAction, setTargetAction] = useState<TargetAction | null>(null);
  const [scale, setScale] = useState(1);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const initialDistanceRef = useRef<number | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(1);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllSpeech();
    };
  }, []);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => phase === 'playing',
    onMoveShouldSetPanResponder: () => phase === 'playing',
    onPanResponderGrant: (evt) => {
      if (evt.nativeEvent.touches.length === 2) {
        const touch1 = evt.nativeEvent.touches[0];
        const touch2 = evt.nativeEvent.touches[1];
        const distance = Math.sqrt(
          Math.pow(touch2.pageX - touch1.pageX, 2) + Math.pow(touch2.pageY - touch1.pageY, 2)
        );
        initialDistanceRef.current = distance;
      }
    },
    onPanResponderMove: (evt) => {
      if (evt.nativeEvent.touches.length === 2 && initialDistanceRef.current !== null) {
        const touch1 = evt.nativeEvent.touches[0];
        const touch2 = evt.nativeEvent.touches[1];
        const currentDistance = Math.sqrt(
          Math.pow(touch2.pageX - touch1.pageX, 2) + Math.pow(touch2.pageY - touch1.pageY, 2)
        );
        const delta = currentDistance - initialDistanceRef.current;
        const newScale = Math.max(0.5, Math.min(2, baseScale.current + delta / 200));
        scaleAnim.setValue(newScale);
        setScale(newScale);
      }
    },
    onPanResponderRelease: (evt) => {
      if (initialDistanceRef.current === null || !targetAction) return;

      if (evt.nativeEvent.touches.length === 2) {
        const touch1 = evt.nativeEvent.touches[0];
        const touch2 = evt.nativeEvent.touches[1];
        const finalDistance = Math.sqrt(
          Math.pow(touch2.pageX - touch1.pageX, 2) + Math.pow(touch2.pageY - touch1.pageY, 2)
        );
        const delta = finalDistance - initialDistanceRef.current;

        if (targetAction === 'stretch' && delta >= STRETCH_THRESHOLD) {
          setCorrect((c) => c + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Perfect! You stretched it!');
        } else if (targetAction === 'pinch' && delta <= PINCH_THRESHOLD) {
          setCorrect((c) => c + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Great! You pinched it!');
        } else {
          setWrong((w) => w + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speakTTS('Try again!');
        }

        // Reset
        baseScale.current = 1;
        scaleAnim.setValue(1);
        setScale(1);
        initialDistanceRef.current = null;

        // Next round
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            generateTarget();
          } else {
            finishGame();
          }
        }, 1500);
      }
    },
  });

  const generateTarget = () => {
    const action: TargetAction = Math.random() > 0.5 ? 'stretch' : 'pinch';
    setTargetAction(action);
    speakTTS(action === 'stretch' ? 'Make it BIG! Stretch with two fingers!' : 'Make it SMALL! Pinch with two fingers!');
  };

  const startGame = () => {
    setPhase('playing');
    setRound(1);
    setCorrect(0);
    setWrong(0);
    baseScale.current = 1;
    scaleAnim.setValue(1);
    setScale(1);
    generateTarget();
  };

  const finishGame = async () => {
    setPhase('finished');
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 15;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'stretch-vs-pinch',
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['pinch-gesture', 'two-finger-coordination', 'spatial-control'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You mastered stretch and pinch!');
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
          <Text style={styles.emoji}>🤏</Text>
          <Text style={styles.title}>Stretch/Pinch Complete!</Text>
          <Text style={styles.subtitle}>You mastered big and small gestures!</Text>

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
          <Text style={styles.emoji}>🤏</Text>
          <Text style={styles.title}>Stretch vs Pinch</Text>
          <Text style={styles.instructions}>
            Use TWO FINGERS!{'\n'}
            Stretch apart to make it BIG{'\n'}
            Pinch together to make it SMALL
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
          <View style={styles.targetIndicator}>
            <Text style={styles.targetText}>
              {targetAction === 'stretch' ? 'MAKE IT BIG!' : 'MAKE IT SMALL!'}
            </Text>
            <Text style={styles.targetSubtext}>
              {targetAction === 'stretch' ? 'Stretch with two fingers' : 'Pinch with two fingers'}
            </Text>
          </View>

          <View style={styles.objectContainer}>
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [{ scale: scaleAnim }],
                },
              ]}
            >
              <LinearGradient
                colors={['#8B5CF6', '#6366F1']}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>🎈</Text>
                <Text style={styles.objectText}>
                  {scale > 1.2 ? 'BIG!' : scale < 0.8 ? 'small' : 'Normal'}
                </Text>
              </LinearGradient>
            </Animated.View>
          </View>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              Use TWO FINGERS on the object above
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
  targetIndicator: {
    backgroundColor: '#F3F4F6',
    padding: 20,
    borderRadius: 20,
    marginBottom: 32,
    borderWidth: 3,
    borderColor: '#8B5CF6',
    alignItems: 'center',
  },
  targetText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#8B5CF6',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 8,
  },
  targetSubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  objectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  object: {
    width: 150,
    height: 150,
    borderRadius: 75,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  objectEmoji: {
    fontSize: 60,
    marginBottom: 8,
  },
  objectText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  instructionBox: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    marginBottom: 24,
  },
  instructionText: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    fontWeight: '600',
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


