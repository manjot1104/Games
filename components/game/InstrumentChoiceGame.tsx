import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, stopTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Helper function for safe speech with error handling
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech(); // Stop any existing speech first
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

type GamePhase = 'idle' | 'listening' | 'choosing' | 'finished';
type Instrument = 'drum' | 'bell' | 'clap';

const INSTRUMENTS: Instrument[] = ['drum', 'bell', 'clap'];

export const InstrumentChoiceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [currentInstrument, setCurrentInstrument] = useState<Instrument | null>(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  // Track all speech timers
  const speechTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Animations
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const triggerGlow = useCallback(() => {
    glowAnim.setValue(0);
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [glowAnim]);

  const playInstrument = useCallback((instrument: Instrument) => {
    setCurrentInstrument(instrument);
    triggerGlow();
    
    // Play the sound
    if (instrument === 'drum') {
      playSound('drum', 0.8, 1.0);
    } else if (instrument === 'bell') {
      playSound('bell', 0.8, 1.0);
    } else if (instrument === 'clap') {
      playSound('clap', 0.8, 1.0);
    }
  }, [triggerGlow]);

  const startRound = useCallback(() => {
    // Clear any existing timers
    speechTimersRef.current.forEach(timer => clearTimeout(timer));
    speechTimersRef.current = [];

    // Randomly select an instrument
    const randomInstrument = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)];
    
    setPhase('listening');
    speak('Listen to the sound!');
    
    // Play the sound after a short delay
    const timer1 = setTimeout(() => {
      playInstrument(randomInstrument);
      
      // After sound plays, show choices
      const timer2 = setTimeout(() => {
        setPhase('choosing');
        speak('Which instrument was that?');
      }, 1500);
      speechTimersRef.current.push(timer2);
    }, 500);
    speechTimersRef.current.push(timer1);
  }, [playInstrument]);

  const finishGame = useCallback(async () => {
    setPhase('finished');
    
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 15;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('API call timeout')), 10000)
      );
      
      const result = await Promise.race([
        logGameAndAward({
          type: 'quiz' as any, // Using quiz type as closest match
          correct,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['sound-discrimination', 'auditory-identification', 'instrument-recognition'],
          meta: { rounds: round },
        }),
        timeoutPromise,
      ]) as any;
      
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
      // Continue even if API call fails - don't block the user
    }

    speak('Amazing! You identified all the instruments!');
  }, [correct, wrong, round, router]);

  const handleInstrumentChoice = useCallback((chosenInstrument: Instrument) => {
    if (phase !== 'choosing' || !currentInstrument) return;

    const isCorrect = chosenInstrument === currentInstrument;
    
    if (isCorrect) {
      setCorrect((c) => c + 1);
      speak('Correct!');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      
      // Success animation
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      setWrong((w) => w + 1);
      speak('Try again!');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }

    // Move to next round or finish
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setCurrentInstrument(null);
        startRound();
      } else {
        finishGame();
      }
    }, 1500);
  }, [phase, currentInstrument, round, startRound, scaleAnim, finishGame]);

  const startGame = useCallback(() => {
    setRound(1);
    setCorrect(0);
    setWrong(0);
    setCurrentInstrument(null);
    startRound();
  }, [startRound]);

  const glowStyle = {
    opacity: glowAnim,
  };

  const scaleStyle = {
    transform: [{ scale: scaleAnim }],
  };

  // Results screen
  if (phase === 'finished' && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => {
            // Clear all speech timers first
            speechTimersRef.current.forEach(timer => clearTimeout(timer));
            speechTimersRef.current = [];
            // Aggressively stop all speech
            stopAllSpeech();
            cleanupSounds();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.resultsContainer}>
          <Text style={styles.emoji}>🎵</Text>
          <Text style={styles.title}>Instrument Choice Complete!</Text>
          <Text style={styles.subtitle}>You identified all the sounds!</Text>

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
          <Text style={styles.emoji}>🎵</Text>
          <Text style={styles.title}>Instrument Choice</Text>
          <Text style={styles.instructions}>
            Listen to the sound,{'\n'}
            then choose which instrument it was!
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
        <View style={styles.gameArea}>
          {phase === 'listening' && (
            <View style={styles.listeningArea}>
              <Animated.View style={[styles.soundCircle, glowStyle, scaleStyle]}>
                <LinearGradient
                  colors={['#F59E0B', '#EF4444']}
                  style={styles.circleGradient}
                >
                  <Text style={styles.soundEmoji}>👂</Text>
                </LinearGradient>
              </Animated.View>
              <Text style={styles.listeningText}>LISTEN...</Text>
            </View>
          )}

          {phase === 'choosing' && (
            <View style={styles.choosingArea}>
              <Text style={styles.chooseText}>Which instrument was that?</Text>
              
              <View style={styles.instrumentsContainer}>
                {INSTRUMENTS.map((instrument) => (
                  <TouchableOpacity
                    key={instrument}
                    style={styles.instrumentButton}
                    onPress={() => handleInstrumentChoice(instrument)}
                    activeOpacity={0.8}
                  >
                    <LinearGradient
                      colors={
                        instrument === 'drum'
                          ? ['#F59E0B', '#D97706']
                          : instrument === 'bell'
                          ? ['#6366F1', '#4F46E5']
                          : ['#10B981', '#059669']
                      }
                      style={styles.instrumentGradient}
                    >
                      <Text style={styles.instrumentEmoji}>
                        {instrument === 'drum' ? '🥁' : instrument === 'bell' ? '🔔' : '👏'}
                      </Text>
                      <Text style={styles.instrumentText}>
                        {instrument.charAt(0).toUpperCase() + instrument.slice(1)}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  listeningArea: {
    alignItems: 'center',
  },
  soundCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    marginBottom: 32,
    shadowColor: '#F59E0B',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  circleGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  soundEmoji: {
    fontSize: 80,
  },
  listeningText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2937',
  },
  choosingArea: {
    width: '100%',
    alignItems: 'center',
  },
  chooseText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 32,
    textAlign: 'center',
  },
  instrumentsContainer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
    gap: 16,
  },
  instrumentButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  instrumentGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  instrumentEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  instrumentText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
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


