import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSpecialEducationProgress } from '../../../shared/SpecialEducationProgress';
import { useHandDetectionWeb } from '@/hooks/useHandDetectionWeb';

const DEFAULT_TTS_RATE = 0.6;

interface Game3TraceProps {
  onBack: () => void;
  onComplete: () => void;
  section: number;
  level: number;
}

type TraceType = 'letter' | 'number';

interface TracePath {
  type: TraceType;
  symbol: string;
  points: Array<{ x: number; y: number }>;
}

export function Game3Trace({ onBack, onComplete, section, level }: Game3TraceProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { markGameComplete } = useSpecialEducationProgress();
  const [currentTrace, setCurrentTrace] = useState<TraceType>('letter');
  const [isTracing, setIsTracing] = useState(false);
  const [traceProgress, setTraceProgress] = useState(0);
  const [round, setRound] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const TOTAL_ROUNDS = 2; // Trace letter A, then number 1

  const handDetection = useHandDetectionWeb(true);
  const tracedPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const progressAnim = useSharedValue(0);

  const traces: TracePath[] = [
    {
      type: 'letter',
      symbol: 'A',
      points: [
        { x: 0.5, y: 0.2 }, // Top
        { x: 0.3, y: 0.6 }, // Left bottom
        { x: 0.4, y: 0.4 }, // Middle left
        { x: 0.6, y: 0.4 }, // Middle right
        { x: 0.7, y: 0.6 }, // Right bottom
        { x: 0.5, y: 0.2 }, // Back to top
      ],
    },
    {
      type: 'number',
      symbol: '1',
      points: [
        { x: 0.5, y: 0.2 }, // Top
        { x: 0.5, y: 0.8 }, // Bottom
      ],
    },
  ];

  const currentTraceData = traces[round - 1];

  const speak = (text: string) => {
    Speech.stop();
    setIsSpeaking(true);
    
    if (Platform.OS === 'web') {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = DEFAULT_TTS_RATE;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } else {
      Speech.speak(text, {
        rate: DEFAULT_TTS_RATE,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
      });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      speak(`Trace the ${currentTraceData.type === 'letter' ? 'letter' : 'number'} ${currentTraceData.symbol} with your finger`);
    }, 500);
    return () => clearTimeout(timer);
  }, [round]);

  // Simplified tracing: just check if user moves finger near the path
  useEffect(() => {
    if (!isTracing || !handDetection.handPosition) return;

    const handX = handDetection.handPosition.x;
    const handY = handDetection.handPosition.y;

    // Check proximity to any point on the path
    let minDistance = Infinity;
    for (const point of currentTraceData.points) {
      const distance = Math.sqrt(
        Math.pow(handX - point.x, 2) + Math.pow(handY - point.y, 2)
      );
      minDistance = Math.min(minDistance, distance);
    }

    // If close enough, add to traced path
    if (minDistance < 0.1) {
      tracedPathRef.current.push({ x: handX, y: handY });
      const progress = Math.min(1, tracedPathRef.current.length / (currentTraceData.points.length * 10));
      setTraceProgress(progress);
      progressAnim.value = withTiming(progress, { duration: 100 });
    }
  }, [handDetection.handPosition, isTracing, currentTraceData]);

  const handleStartTrace = () => {
    setIsTracing(true);
    tracedPathRef.current = [];
    setTraceProgress(0);
    progressAnim.value = 0;
  };

  const handleCompleteTrace = () => {
    setIsTracing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    speak('Great job!');

    if (round < TOTAL_ROUNDS) {
      setTimeout(() => {
        setRound(round + 1);
        setTraceProgress(0);
        tracedPathRef.current = [];
      }, 2000);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    const accuracy = Math.round(traceProgress * 100);
    try {
      await markGameComplete(section, level, 3, accuracy);
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
    setTimeout(() => {
      onComplete();
    }, 1500);
  };

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%`,
  }));

  // Render trace path as guide
  const renderTracePath = () => {
    const centerX = screenWidth * 0.5;
    const centerY = screenHeight * 0.5;
    const size = Math.min(screenWidth, screenHeight) * 0.4;

    return (
      <View style={styles.traceContainer}>
        <View style={[styles.traceGuide, { width: size, height: size }]}>
          <Text
            style={[
              styles.traceSymbol,
              {
                fontSize: size * 0.6,
                color: currentTraceData.type === 'letter' ? '#3B82F6' : '#10B981',
              },
            ]}
          >
            {currentTraceData.symbol}
          </Text>
          {tracedPathRef.current.length > 0 && (
            <View style={styles.tracedPath}>
              {/* Visual feedback for traced path */}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game 3: The Trace</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            {isTracing
              ? 'Move your finger along the path'
              : `Round ${round}/${TOTAL_ROUNDS}: Trace the ${currentTraceData.type === 'letter' ? 'letter' : 'number'}`}
          </Text>
          {isSpeaking && (
            <View style={styles.speakingIndicator}>
              <ActivityIndicator size="small" color="#3B82F6" />
            </View>
          )}
        </View>

        {renderTracePath()}

        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, progressAnimatedStyle]} />
          </View>
          <Text style={styles.progressText}>
            {Math.round(traceProgress * 100)}% Complete
          </Text>
        </View>

        {!isTracing ? (
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartTrace}
            activeOpacity={0.8}
          >
            <Text style={styles.startButtonText}>Start Tracing</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.completeButton, traceProgress >= 0.7 && styles.completeButtonActive]}
            onPress={handleCompleteTrace}
            disabled={traceProgress < 0.7}
            activeOpacity={0.8}
          >
            <Text style={styles.completeButtonText}>
              {traceProgress >= 0.7 ? 'Complete ✓' : 'Keep Tracing...'}
            </Text>
          </TouchableOpacity>
        )}

        {!handDetection.handPosition && (
          <View style={styles.handWarning}>
            <Ionicons name="hand-left-outline" size={24} color="#F59E0B" />
            <Text style={styles.handWarningText}>Show your hand to the camera</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  instructionText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  speakingIndicator: {
    marginTop: 8,
  },
  traceContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
  },
  traceGuide: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    borderWidth: 4,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  traceSymbol: {
    fontWeight: '900',
  },
  tracedPath: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  progressContainer: {
    width: '100%',
    marginBottom: 24,
  },
  progressBar: {
    width: '100%',
    height: 12,
    backgroundColor: '#E2E8F0',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  startButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
  },
  completeButton: {
    backgroundColor: '#9CA3AF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
  },
  completeButtonActive: {
    backgroundColor: '#10B981',
  },
  completeButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
  },
  handWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
  },
  handWarningText: {
    fontSize: 14,
    color: '#F59E0B',
    fontWeight: '600',
  },
});


