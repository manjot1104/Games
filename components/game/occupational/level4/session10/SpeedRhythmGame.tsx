import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const INITIAL_BEAT_INTERVAL = 800;
const MIN_BEAT_INTERVAL = 400;
const INTERVAL_DECREASE = 50;
const TOLERANCE_MULTIPLIER = 0.4; // Tolerance as percentage of interval
type Action = 'left' | 'right';

const PATTERNS: Action[][] = [
  ['left', 'right'],
  ['right', 'left'],
  ['left', 'right', 'left'],
  ['right', 'left', 'right'],
  ['left', 'left', 'right'],
  ['right', 'right', 'left'],
  ['left', 'right', 'left', 'right'],
  ['right', 'left', 'right', 'left'],
  ['left', 'right', 'right', 'left'],
  ['right', 'left', 'left', 'right'],
];

// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const SpeedRhythmGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [phase, setPhase] = useState<'listen' | 'copy'>('listen');
  const [pattern, setPattern] = useState<Action[]>([]);
  const [userPattern, setUserPattern] = useState<{ time: number; action: Action }[]>([]);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [beatInterval, setBeatInterval] = useState(INITIAL_BEAT_INTERVAL);

  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const patternStartTime = useRef(0);

  const playPattern = useCallback((patternToPlay: Action[], interval: number) => {
    setIsPlaying(true);
    setPhase('listen');
    setCurrentBeat(0);
    patternStartTime.current = Date.now();
    
    let beatIndex = 0;
    
    const playNextBeat = () => {
      if (beatIndex >= patternToPlay.length) {
        setIsPlaying(false);
        setPhase('copy');
        setUserPattern([]);
        patternStartTime.current = Date.now();
        speak('Now copy!');
        return;
      }
      
      const action = patternToPlay[beatIndex];
      const handScale = action === 'left' ? leftHandScale : rightHandScale;
      
      Animated.sequence([
        Animated.timing(handScale, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(handScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
      
      playSound('drum', 0.8, 1.0);
      setCurrentBeat(beatIndex + 1);
      
      beatIndex++;
      if (beatIndex < patternToPlay.length) {
        beatTimeoutRef.current = setTimeout(playNextBeat, interval) as any;
      } else {
        beatTimeoutRef.current = setTimeout(() => {
          setIsPlaying(false);
          setPhase('copy');
          setUserPattern([]);
          patternStartTime.current = Date.now();
          speak('Now copy!');
        }, interval) as any;
      }
    };
    
    const speedText = interval >= 700 ? 'slow' : interval >= 500 ? 'medium' : 'fast';
    speak(`Listen to the ${speedText} rhythm!`);
    setTimeout(() => playNextBeat(), 500);
  }, [leftHandScale, rightHandScale]);

  const handleAction = useCallback((action: Action) => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    const tolerance = beatInterval * TOLERANCE_MULTIPLIER;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, action }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * beatInterval;
          const actualTime = newPattern[i].time;
          const expectedAction = pattern[i];
          const actualAction = newPattern[i].action;
          
          if (Math.abs(actualTime - expectedTime) > tolerance || actualAction !== expectedAction) {
            matches = false;
            break;
          }
        }
        
        if (matches) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speak('Perfect!');
          
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              const newInterval = Math.max(
                MIN_BEAT_INTERVAL,
                INITIAL_BEAT_INTERVAL - (round * INTERVAL_DECREASE)
              );
              setBeatInterval(newInterval);
              const newPattern = PATTERNS[(round % PATTERNS.length)];
              setPattern(newPattern);
              playPattern(newPattern, newInterval);
            } else {
              endGame();
            }
          }, 1000);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          speak('Try again!');
          setUserPattern([]);
          patternStartTime.current = Date.now();
        }
      }
      
      return newPattern;
    });
    
    // Visual feedback
    const handScale = action === 'left' ? leftHandScale : rightHandScale;
    Animated.sequence([
      Animated.timing(handScale, {
        toValue: 1.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(handScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    playSound('drum', 0.6, 1.0);
  }, [phase, done, pattern, round, beatInterval, leftHandScale, rightHandScale, playPattern]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 20;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    
    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'speed-rhythm',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['control', 'flexibility', 'speed-regulation', 'rhythm', 'cross-body-coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done) {
      const newInterval = Math.max(
        MIN_BEAT_INTERVAL,
        INITIAL_BEAT_INTERVAL - ((round - 1) * INTERVAL_DECREASE)
      );
      setBeatInterval(newInterval);
      const newPattern = PATTERNS[(round - 1) % PATTERNS.length];
      setPattern(newPattern);
      setTimeout(() => playPattern(newPattern, newInterval), 500);
    }
  }, [showInfo, round, done, playPattern]);

  useEffect(() => {
    return () => {
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
      }
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const getSpeedText = () => {
    if (beatInterval >= 700) return 'Slow';
    if (beatInterval >= 500) return 'Medium';
    return 'Fast!';
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Speed Rhythm"
        emoji="⚡"
        description="Slow → fast rhythm! Control + flexibility!"
        skills={['Control + flexibility', 'Speed regulation', 'Rhythm']}
        suitableFor="Children learning to adapt rhythm speed from slow to fast"
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
            setPhase('listen');
            setUserPattern([]);
            setBeatInterval(INITIAL_BEAT_INTERVAL);
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
        <Text style={styles.title}>Speed Rhythm</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.speedIndicator}>
          Speed: {getSpeedText()} ({beatInterval}ms)
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen'
            ? `Listen... (${currentBeat}/${pattern.length})`
            : `Copy! (${userPattern.length}/${pattern.length})`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={() => handleAction('left')}
            activeOpacity={0.8}
            disabled={phase === 'listen'}
          >
            <Animated.View
              style={[
                styles.hand,
                styles.leftHand,
                { transform: [{ scale: leftHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={() => handleAction('right')}
            activeOpacity={0.8}
            disabled={phase === 'listen'}
          >
            <Animated.View
              style={[
                styles.hand,
                styles.rightHand,
                { transform: [{ scale: rightHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Control + flexibility • Speed regulation • Rhythm
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
    marginBottom: 8,
  },
  speedIndicator: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '700',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  handButton: {
    width: 160,
    height: 160,
  },
  hand: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftHand: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHand: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handEmoji: {
    fontSize: 60,
    marginBottom: 8,
  },
  handLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default SpeedRhythmGame;
