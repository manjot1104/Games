import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTON_SIZE = 120;
const TOLERANCE = 60;

const GoStopGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [showGo, setShowGo] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const buttonTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showButton = useCallback(() => {
    const isGo = Math.random() > 0.5;
    
    if (isGo) {
      setShowGo(true);
      setShowStop(false);
      speakTTS('Go!', 0.9, 'en-US' );
    } else {
      setShowGo(false);
      setShowStop(true);
      speakTTS('Stop!', 0.9, 'en-US' );
    }

    // Hide after 2 seconds
    if (buttonTimerRef.current) {
      clearTimeout(buttonTimerRef.current);
    }
    buttonTimerRef.current = setTimeout(() => {
      setShowGo(false);
      setShowStop(false);
    }, 2000);
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    const centerX = screenWidth.current / 2;
    const centerY = screenHeight.current / 2;
    
    const distance = Math.sqrt(
      Math.pow(tapX - centerX, 2) + Math.pow(tapY - centerY, 2)
    );

    if (distance <= TOLERANCE + BUTTON_SIZE / 2) {
      if (showGo) {
        // Correct - tapped Go
        if (buttonTimerRef.current) {
          clearTimeout(buttonTimerRef.current);
        }
        setShowGo(false);

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setTimeout(() => showButton(), 1000);
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Good!', 0.9, 'en-US' );
      } else if (showStop) {
        // Wrong - tapped when Stop was shown
        if (buttonTimerRef.current) {
          clearTimeout(buttonTimerRef.current);
        }
        setShowStop(false);

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Stop means no tap!', 0.8, 'en-US' );
        
        setTimeout(() => {
          setRound((r) => r + 1);
          setTimeout(() => showButton(), 1000);
        }, 1500);
      }
    }
  }, [done, showGo, showStop, showButton]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (buttonTimerRef.current) {
      clearTimeout(buttonTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'go-stop',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['inhibition', 'impulse-control', 'response-inhibition'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      setTimeout(() => {
        showButton();
        speakTTS('Green tap, red no tap!', { rate: 0.8, language: 'en-US' });
      }, 1000);
    }
  }, [showInfo, round, done, showButton]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (buttonTimerRef.current) {
        clearTimeout(buttonTimerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Go / Stop"
        emoji="🚦"
        description="Green tap, red no tap! Build inhibition."
        skills={['Inhibition']}
        suitableFor="Children learning impulse control and response inhibition"
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
            showButton();
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
        <Text style={styles.title}>Go / Stop</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚦 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showGo ? 'TAP!' : showStop ? 'DON\'T TAP!' : 'Get ready...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        {showGo && (
          <View style={[styles.button, styles.goButton]}>
            <Text style={styles.buttonEmoji}>🟢</Text>
            <Text style={styles.buttonText}>GO</Text>
          </View>
        )}
        {showStop && (
          <View style={[styles.button, styles.stopButton]}>
            <Text style={styles.buttonEmoji}>🔴</Text>
            <Text style={styles.buttonText}>STOP</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Inhibition
        </Text>
        <Text style={styles.footerSubtext}>
          Green tap, red no tap!
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
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  goButton: {
    backgroundColor: '#10B981',
    borderWidth: 4,
    borderColor: '#059669',
  },
  stopButton: {
    backgroundColor: '#EF4444',
    borderWidth: 4,
    borderColor: '#DC2626',
  },
  buttonEmoji: {
    fontSize: 40,
    marginBottom: 4,
  },
  buttonText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default GoStopGame;
