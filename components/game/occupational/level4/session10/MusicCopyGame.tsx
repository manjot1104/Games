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
const BEAT_INTERVAL = 600;
const TOLERANCE = 250;
type Movement = 'left-hand' | 'right-hand' | 'both-hands';

const PATTERNS: Movement[][] = [
  ['left-hand', 'right-hand'],
  ['right-hand', 'left-hand'],
  ['left-hand', 'right-hand', 'left-hand'],
  ['both-hands', 'left-hand', 'right-hand'],
  ['right-hand', 'both-hands', 'left-hand'],
  ['left-hand', 'both-hands', 'right-hand', 'both-hands'],
  ['right-hand', 'left-hand', 'right-hand', 'left-hand', 'both-hands'],
  ['both-hands', 'left-hand', 'both-hands', 'right-hand', 'both-hands'],
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

const MusicCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [phase, setPhase] = useState<'listen' | 'copy'>('listen');
  const [pattern, setPattern] = useState<Movement[]>([]);
  const [userPattern, setUserPattern] = useState<{ time: number; movement: Movement }[]>([]);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;
  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const patternStartTime = useRef(0);

  const playPattern = useCallback((patternToPlay: Movement[]) => {
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
        speak('Now copy with the beat!');
        return;
      }
      
      const movement = patternToPlay[beatIndex];
      
      // Visual and audio feedback
      if (movement === 'left-hand') {
        Animated.sequence([
          Animated.timing(leftHandScale, {
            toValue: 1.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(leftHandScale, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
        ]).start();
      } else if (movement === 'right-hand') {
        Animated.sequence([
          Animated.timing(rightHandScale, {
            toValue: 1.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(rightHandScale, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        // Both hands
        Animated.parallel([
          Animated.sequence([
            Animated.timing(leftHandScale, {
              toValue: 1.3,
              duration: 100,
              useNativeDriver: true,
            }),
            Animated.timing(leftHandScale, {
              toValue: 1,
              duration: 100,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(rightHandScale, {
              toValue: 1.3,
              duration: 100,
              useNativeDriver: true,
            }),
            Animated.timing(rightHandScale, {
              toValue: 1,
              duration: 100,
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
          speak('Now copy with the beat!');
        }, BEAT_INTERVAL) as any;
      }
    };
    
    speak('Listen to the beat pattern!');
    setTimeout(() => playNextBeat(), 500);
  }, [leftHandScale, rightHandScale]);

  const handleMovement = useCallback((movement: Movement) => {
    if (phase !== 'copy' || done) return;
    
    const now = Date.now();
    const relativeTime = now - patternStartTime.current;
    
    setUserPattern((prev) => {
      const newPattern = [...prev, { time: relativeTime, movement }];
      
      if (newPattern.length === pattern.length) {
        // Check if pattern matches (both timing and movement type)
        let matches = true;
        for (let i = 0; i < pattern.length; i++) {
          const expectedTime = i * BEAT_INTERVAL;
          const actualTime = newPattern[i].time;
          const expectedMovement = pattern[i];
          const actualMovement = newPattern[i].movement;
          
          if (Math.abs(actualTime - expectedTime) > TOLERANCE || actualMovement !== expectedMovement) {
            matches = false;
            break;
          }
        }
        
        if (matches) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speak('Perfect sync!');
          
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
    if (movement === 'left-hand') {
      Animated.sequence([
        Animated.timing(leftHandScale, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(leftHandScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (movement === 'right-hand') {
      Animated.sequence([
        Animated.timing(rightHandScale, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(rightHandScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.sequence([
          Animated.timing(leftHandScale, {
            toValue: 1.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(leftHandScale, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(rightHandScale, {
            toValue: 1.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(rightHandScale, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
    
    playSound('drum', 0.6, 1.0);
  }, [phase, done, pattern, round, leftHandScale, rightHandScale, playPattern]);

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
        type: 'music-copy',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['auditory-motor-sync', 'rhythm', 'beat-synchronization', 'cross-body-coordination'],
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
        title="Music Copy"
        emoji="🎵"
        description="Beat ke sath movements! Auditory-motor sync!"
        skills={['Auditory-motor sync', 'Beat synchronization', 'Rhythm']}
        suitableFor="Children learning to synchronize movements with beats"
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
        <Text style={styles.title}>Music Copy</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'listen'
            ? `Listen... (${currentBeat}/${pattern.length})`
            : `Copy with the beat! (${userPattern.length}/${pattern.length})`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={() => handleMovement('left-hand')}
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
            style={styles.bothButton}
            onPress={() => handleMovement('both-hands')}
            activeOpacity={0.8}
            disabled={phase === 'listen'}
          >
            <Animated.View style={styles.bothHands}>
              <Text style={styles.bothEmoji}>🤲</Text>
              <Text style={styles.bothLabel}>BOTH</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={() => handleMovement('right-hand')}
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
          Skills: Auditory-motor sync • Beat synchronization • Rhythm
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
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  handButton: {
    width: 140,
    height: 140,
  },
  hand: {
    width: 140,
    height: 140,
    borderRadius: 70,
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
    fontSize: 50,
    marginBottom: 5,
  },
  handLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  bothButton: {
    width: 140,
    height: 140,
  },
  bothHands: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    backgroundColor: '#8B5CF6',
    borderColor: '#7C3AED',
  },
  bothEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  bothLabel: {
    fontSize: 14,
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

export default MusicCopyGame;
