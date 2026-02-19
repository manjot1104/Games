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
const BIG_THROW_THRESHOLD = 250; // Minimum drag distance for big throw
const SMALL_THROW_THRESHOLD = 80; // Maximum drag distance for small throw

type GamePhase = 'idle' | 'playing' | 'finished';
type ThrowType = 'big' | 'small';

export const BigThrowVsSmallThrowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [targetThrow, setTargetThrow] = useState<ThrowType | null>(null);
  const [objectPosition, setObjectPosition] = useState({ x: 50, y: 400 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const objectAnim = useRef(new Animated.ValueXY({ x: 50, y: 400 })).current;
  const basePosition = useRef({ x: 50, y: 400 });

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
      setIsDragging(true);
      const startX = evt.nativeEvent.pageX;
      const startY = evt.nativeEvent.pageY;
      setDragStart({ x: startX, y: startY });
      basePosition.current = { x: objectPosition.x, y: objectPosition.y };
    },
    onPanResponderMove: (evt) => {
      if (isDragging && dragStart) {
        const currentX = evt.nativeEvent.pageX;
        const currentY = evt.nativeEvent.pageY;
        const deltaX = currentX - dragStart.x;
        const deltaY = currentY - dragStart.y;
        
        // Update visual position while dragging
        const newX = Math.max(0, Math.min(400, basePosition.current.x + deltaX));
        const newY = Math.max(0, Math.min(600, basePosition.current.y + deltaY));
        objectAnim.setValue({ x: newX, y: newY });
        setObjectPosition({ x: newX, y: newY });
      }
    },
    onPanResponderRelease: (evt) => {
      if (!isDragging || !dragStart || !targetThrow) return;

      const endX = evt.nativeEvent.pageX;
      const endY = evt.nativeEvent.pageY;
      const distance = Math.sqrt(
        Math.pow(endX - dragStart.x, 2) + Math.pow(endY - dragStart.y, 2)
      );

      let isCorrect = false;
      if (targetThrow === 'big' && distance >= BIG_THROW_THRESHOLD) {
        isCorrect = true;
        // Animate throw far
        Animated.timing(objectAnim, {
          toValue: { x: 350, y: 100 },
          duration: 500,
          useNativeDriver: false,
        }).start();
      } else if (targetThrow === 'small' && distance <= SMALL_THROW_THRESHOLD && distance > 10) {
        isCorrect = true;
        // Animate throw near
        Animated.timing(objectAnim, {
          toValue: { x: 150, y: 350 },
          duration: 300,
          useNativeDriver: false,
        }).start();
      }

      if (isCorrect) {
        setCorrect((c) => c + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS(targetThrow === 'big' ? 'Great throw! Far!' : 'Perfect! Short throw!');
      } else {
        setWrong((w) => w + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Try again!');
      }

      setIsDragging(false);
      setDragStart(null);

      // Reset and next round
      setTimeout(() => {
        basePosition.current = { x: 50, y: 400 };
        objectAnim.setValue({ x: 50, y: 400 });
        setObjectPosition({ x: 50, y: 400 });
        
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          generateTarget();
        } else {
          finishGame();
        }
      }, 2000);
    },
  });

  const generateTarget = () => {
    const throwType: ThrowType = Math.random() > 0.5 ? 'big' : 'small';
    setTargetThrow(throwType);
    speakTTS(throwType === 'big' ? 'Throw it FAR! Drag long!' : 'Throw it NEAR! Drag short!');
  };

  const startGame = () => {
    setPhase('playing');
    setRound(1);
    setCorrect(0);
    setWrong(0);
    basePosition.current = { x: 50, y: 400 };
    objectAnim.setValue({ x: 50, y: 400 });
    setObjectPosition({ x: 50, y: 400 });
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
        type: 'tap', // Using 'tap' as closest match
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['drag-gesture', 'movement-range', 'motor-control'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You mastered big and small throws!');
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
          <Text style={styles.emoji}>⚽</Text>
          <Text style={styles.title}>Throw Game Complete!</Text>
          <Text style={styles.subtitle}>You mastered big and small throws!</Text>

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
          <Text style={styles.emoji}>⚽</Text>
          <Text style={styles.title}>Big Throw vs Small Throw</Text>
          <Text style={styles.instructions}>
            Drag the ball to throw it!{'\n'}
            Long drag = throw FAR{'\n'}
            Short drag = throw NEAR
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
              {targetThrow === 'big' ? 'THROW FAR!' : 'THROW NEAR!'}
            </Text>
            <Text style={styles.targetSubtext}>
              {targetThrow === 'big' ? 'Drag long to throw far' : 'Drag short to throw near'}
            </Text>
          </View>

          <View style={styles.throwArea}>
            <Animated.View
              style={[
                styles.throwObject,
                {
                  transform: [
                    { translateX: objectAnim.x },
                    { translateY: objectAnim.y },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={['#F59E0B', '#D97706']}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>⚽</Text>
              </LinearGradient>
            </Animated.View>

            {/* Distance markers */}
            <View style={styles.markersContainer}>
              <View style={[styles.marker, styles.nearMarker]}>
                <Text style={styles.markerText}>NEAR</Text>
              </View>
              <View style={[styles.marker, styles.farMarker]}>
                <Text style={styles.markerText}>FAR</Text>
              </View>
            </View>
          </View>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              {isDragging
                ? 'Release to throw!'
                : 'Drag the ball to throw it ' + (targetThrow === 'big' ? 'FAR' : 'NEAR')}
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
    marginBottom: 24,
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
  throwArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    position: 'relative',
    overflow: 'hidden',
  },
  throwObject: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  objectEmoji: {
    fontSize: 36,
  },
  markersContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  marker: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2,
  },
  nearMarker: {
    backgroundColor: '#D1FAE5',
    borderColor: '#10B981',
  },
  farMarker: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  markerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  instructionBox: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    marginTop: 24,
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


