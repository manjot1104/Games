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

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BEAT_INTERVAL = 700;
const TOLERANCE = 300;
type Action = 'right-to-left' | 'left-to-right';

const PATTERNS: Action[][] = [
  ['right-to-left'],
  ['left-to-right'],
  ['right-to-left', 'left-to-right'],
  ['left-to-right', 'right-to-left'],
  ['right-to-left', 'right-to-left', 'left-to-right'],
  ['left-to-right', 'left-to-right', 'right-to-left'],
  ['right-to-left', 'left-to-right', 'right-to-left', 'left-to-right'],
  ['left-to-right', 'right-to-left', 'left-to-right', 'right-to-left', 'left-to-right'],
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

const TapShoulderPatternGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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

  const rightHandScale = useRef(new Animated.Value(1)).current;
  const leftHandScale = useRef(new Animated.Value(1)).current;
  const leftShoulderScale = useRef(new Animated.Value(1)).current;
  const rightShoulderScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const patternStartTime = useRef(0);

  const playPattern = useCallback((patternToPlay: Action[]) => {
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
        speak('Now copy the pattern!');
        return;
      }
      
      const action = patternToPlay[beatIndex];
      
      // Visual feedback - animate the hand and shoulder
      if (action === 'right-to-left') {
        Animated.parallel([
          Animated.sequence([
            Animated.timing(rightHandScale, {
              toValue: 1.3,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(rightHandScale, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(leftShoulderScale, {
              toValue: 1.2,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(leftShoulderScale, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      } else {
        Animated.parallel([
          Animated.sequence([
            Animated.timing(leftHandScale, {
              toValue: 1.3,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(leftHandScale, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(rightShoulderScale, {
              toValue: 1.2,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(rightShoulderScale, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      }
      
      playSound('drum', 0.8, 1.0);
      setCurrentBeat(beatIndex + 1);
      
      beatIndex++;
      if (beatIndex < patternToPlay.length) {
        beatTimeoutRef.current = setTimeout(playNextBeat, BEAT_INTERVAL) as any;
      } else {
        beatTimeoutRef.current = setTimeout(() => {
          setIsPlaying(false);
          setPhase('copy');
          setUserPattern([]);
          patternStartTime.current = Date.now();
          speak('Now copy the pattern!');
        }, BEAT_INTERVAL) as any;
      }
    };
    
    speak('Watch the pattern!');
    setTimeout(() => playNextBeat(), 500);
  }, [rightHandScale, leftHandScale, leftShoulderScale, rightShoulderScale]);

  const handleRightToLeft = useCallback(() => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, action: 'right-to-left' }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches (both timing and action)
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * BEAT_INTERVAL;
          const actualTime = newPattern[i].time;
          const expectedAction = pattern[i];
          const actualAction = newPattern[i].action;
          
          if (Math.abs(actualTime - expectedTime) > TOLERANCE || actualAction !== expectedAction) {
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
              const newPattern = PATTERNS[(round % PATTERNS.length)];
              setPattern(newPattern);
              playPattern(newPattern);
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
    Animated.parallel([
      Animated.sequence([
        Animated.timing(rightHandScale, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(rightHandScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(leftShoulderScale, {
          toValue: 1.2,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(leftShoulderScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    
    playSound('drum', 0.6, 1.0);
  }, [phase, done, pattern, round, rightHandScale, leftShoulderScale, playPattern]);

  const handleLeftToRight = useCallback(() => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, action: 'left-to-right' }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches (both timing and action)
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * BEAT_INTERVAL;
          const actualTime = newPattern[i].time;
          const expectedAction = pattern[i];
          const actualAction = newPattern[i].action;
          
          if (Math.abs(actualTime - expectedTime) > TOLERANCE || actualAction !== expectedAction) {
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
              const newPattern = PATTERNS[(round % PATTERNS.length)];
              setPattern(newPattern);
              playPattern(newPattern);
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
    Animated.parallel([
      Animated.sequence([
        Animated.timing(leftHandScale, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(leftHandScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(rightShoulderScale, {
          toValue: 1.2,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(rightShoulderScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    
    playSound('drum', 0.6, 1.0);
  }, [phase, done, pattern, round, leftHandScale, rightShoulderScale, playPattern]);

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
        type: 'tap-shoulder-pattern',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['body-mapping', 'cross-body-coordination', 'pattern-copying'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done) {
      const newPattern = PATTERNS[(round - 1) % PATTERNS.length];
      setPattern(newPattern);
      setTimeout(() => playPattern(newPattern), 500);
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

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Tap-Shoulder Pattern"
        emoji="👆"
        description="Right hand → left shoulder! Body mapping!"
        skills={['Body mapping', 'Cross-body coordination', 'Pattern copying']}
        suitableFor="Children learning cross-body body mapping and pattern copying"
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
        <Text style={styles.title}>Tap-Shoulder Pattern</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen'
            ? `Watch... (${currentBeat}/${pattern.length})`
            : `Copy the pattern! (${userPattern.length}/${pattern.length})`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {/* Shoulders */}
        <View style={styles.shouldersContainer}>
          <Animated.View
            style={[
              styles.shoulder,
              styles.leftShoulder,
              { transform: [{ scale: leftShoulderScale }] },
            ]}
          >
            <Text style={styles.shoulderEmoji}>👈</Text>
            <Text style={styles.shoulderLabel}>LEFT</Text>
          </Animated.View>
          <Animated.View
            style={[
              styles.shoulder,
              styles.rightShoulder,
              { transform: [{ scale: rightShoulderScale }] },
            ]}
          >
            <Text style={styles.shoulderEmoji}>👉</Text>
            <Text style={styles.shoulderLabel}>RIGHT</Text>
          </Animated.View>
        </View>

        {/* Hands */}
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={handleRightToLeft}
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
              <Text style={styles.handLabel}>RIGHT → LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={handleLeftToRight}
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
              <Text style={styles.handLabel}>LEFT → RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Body mapping • Cross-body coordination • Pattern copying
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
  shouldersContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 60,
  },
  shoulder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftShoulder: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightShoulder: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  shoulderEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  shoulderLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
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
    backgroundColor: '#10B981',
    borderColor: '#059669',
  },
  rightHand: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  handEmoji: {
    fontSize: 60,
    marginBottom: 8,
  },
  handLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
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

export default TapShoulderPatternGame;
