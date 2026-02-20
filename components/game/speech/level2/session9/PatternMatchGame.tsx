/**
 * Pattern Match Game
 * Show target pattern tiles at top, child selects/arranges tiles below to match (5-6 matches per round)
 */

import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { logGameAndAward } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

// Conditional import for VisionCamera
let Camera: any = null;
if (Platform.OS !== 'web') {
  try {
    Camera = require('react-native-vision-camera').Camera;
  } catch (e) {
    console.warn('VisionCamera not available:', e);
  }
}

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

type TileState = 'open' | 'closed';

interface Pattern {
  tiles: TileState[];
}

interface RoundResult {
  round: number;
  stars: number;
  matches: number;
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 20000; // 20 seconds per round
const STABILITY_MS = 300;
const DEFAULT_TTS_RATE = 0.75;

// Pattern templates
const PATTERNS: Pattern[] = [
  { tiles: ['open', 'closed', 'open'] },
  { tiles: ['closed', 'open', 'closed', 'open'] },
  { tiles: ['open', 'open', 'closed'] },
  { tiles: ['closed', 'open', 'open', 'closed'] },
  { tiles: ['open', 'closed', 'closed', 'open'] },
  { tiles: ['closed', 'closed', 'open', 'open', 'closed'] },
];

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

export function PatternMatchGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth = 0, height: screenHeight = 0 } = useWindowDimensions();
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [targetPattern, setTargetPattern] = useState<Pattern>({ tiles: [] });
  const [selectedTiles, setSelectedTiles] = useState<TileState[]>([]);
  const [matches, setMatches] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    totalMatches: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStep, setVerificationStep] = useState(0);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableJawStateRef = useRef<{ state: boolean; since: number } | null>(null);
  const verificationStartTimeRef = useRef<number | null>(null);
  const lastMatchTimeRef = useRef(0);
  const matchCooldown = 2000; // 2 seconds between matches

  // Generate new pattern
  const generatePattern = useCallback(() => {
    const patternIndex = Math.floor(Math.random() * PATTERNS.length);
    const pattern = PATTERNS[patternIndex];
    setTargetPattern(pattern);
    setSelectedTiles([]);
    setIsVerifying(false);
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
  }, []);

  // Handle tile selection
  const handleTileSelect = useCallback((tile: TileState) => {
    if (isVerifying) return;
    
    setSelectedTiles(prev => {
      const newTiles = [...prev, tile];
      
      // Check if pattern is complete
      if (newTiles.length === targetPattern.tiles.length) {
        // Start verification
        setIsVerifying(true);
        setVerificationStep(0);
        verificationStartTimeRef.current = Date.now();
        speak('Now perform the pattern!');
      }
      
      return newTiles;
    });
  }, [targetPattern, isVerifying]);

  // Verify pattern by performing sequence
  useEffect(() => {
    if (!isVerifying || gameState !== 'playing' || !isDetecting || !verificationStartTimeRef.current) return;

    const now = Date.now();
    const expectedStep = targetPattern.tiles[verificationStep];
    
    if (!expectedStep) {
      // Pattern verification complete
      const isMatch = selectedTiles.every((tile, index) => tile === targetPattern.tiles[index]);
      
      if (isMatch && now - lastMatchTimeRef.current > matchCooldown) {
        lastMatchTimeRef.current = now;
        setMatches(prev => prev + 1);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
        speak('Perfect match!');
        
        // Generate new pattern
        setTimeout(() => {
          generatePattern();
        }, 1000);
      } else {
        speak('Try again!');
        generatePattern();
      }
      
      setIsVerifying(false);
      setVerificationStep(0);
      verificationStartTimeRef.current = null;
      return;
    }

    // Stability check
    if (stableJawStateRef.current?.state === isOpen) {
      if (now - stableJawStateRef.current.since >= STABILITY_MS) {
        const expectedState = expectedStep === 'open';
        
        if (isOpen === expectedState) {
          // Correct state - move to next step
          if (verificationStartTimeRef.current === null) {
            verificationStartTimeRef.current = now;
          } else {
            // Hold for at least 500ms before moving to next step
            if (now - verificationStartTimeRef.current >= 500) {
              setVerificationStep(prev => prev + 1);
              verificationStartTimeRef.current = now;
            }
          }
        }
      }
    } else {
      stableJawStateRef.current = { state: isOpen, since: now };
    }
  }, [isOpen, isDetecting, gameState, isVerifying, targetPattern, selectedTiles, verificationStep, generatePattern]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    generatePattern();
    setMatches(0);
    setTimeElapsed(0);
    stableJawStateRef.current = null;
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
    lastMatchTimeRef.current = 0;

    if (currentRound === 1) {
      speak(
        'Welcome to Pattern Match! Arrange tiles to match the pattern, then perform it! ' +
        'Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound, generatePattern]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    speak('Get ready!');

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          startRound();
          return 0;
        }
        speak(prev - 1 === 0 ? 'Go!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    generatePattern();
    setMatches(0);
    setTimeElapsed(0);
    stableJawStateRef.current = null;
    setVerificationStep(0);
    verificationStartTimeRef.current = null;
    lastMatchTimeRef.current = 0;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      if (elapsed >= ROUND_TIME_MS / 1000) {
        endRound();
      }
    }, 100);
  }, [generatePattern]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let stars = 0;
    if (matches >= 5) {
      stars = 3;
    } else if (matches >= 4) {
      stars = 2;
    } else if (matches >= 2) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      matches,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    setShowRoundSuccess(true);
    setGameState('roundComplete');

    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        startCalibration();
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, matches, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const totalMatches = roundResults.reduce((sum, r) => sum + r.matches, 0);
    const accuracy = Math.round((totalMatches / (requiredRounds * 5)) * 100);

    const stats = {
      totalRounds: requiredRounds,
      totalMatches,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);

    speak(`Amazing! You matched ${totalMatches} patterns!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'pattern-match',
        correct: totalMatches,
        total: requiredRounds * 5,
        accuracy,
        xpAwarded,
        skillTags: ['oral-sequences', 'pattern-matching', 'visual-sequencing', 'motor-sequencing'],
        meta: {
          totalRounds: requiredRounds,
          totalMatches,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, requiredRounds]);

  // Auto-start calibration when camera is ready
  useEffect(() => {
    if (hasCamera && isDetecting && gameState === 'calibration' && currentRound === 1) {
      const timer = setTimeout(() => {
        startCountdown();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [hasCamera, isDetecting, gameState, currentRound, startCountdown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Ensure container has data-native-id attribute for hook to find it (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;
    
    const setAttribute = () => {
      try {
        let element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        if (!element) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.current || 
                              (previewRef.current as any)?.base || 
                              previewRef.current;
            if (refElement && refElement.nodeType === 1) {
              element = refElement;
            }
          } catch (e) {}
        }
        if (element && !element.getAttribute('data-native-id')) {
          element.setAttribute('data-native-id', previewContainerId);
        }
      } catch (e) {}
    };
    
    setAttribute();
    const timeouts = [100, 500, 1000, 2000].map(delay => 
      setTimeout(setAttribute, delay)
    );
    
    return () => timeouts.forEach(clearTimeout);
  }, [previewContainerId]);

  // Ensure video is in the correct full-screen container and remove duplicates (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const moveVideoToContainer = () => {
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.current || 
                            (previewRef.current as any)?.base || 
                            previewRef.current;
          if (refElement && refElement.nodeType === 1) {
            container = refElement;
          }
        } catch (e) {}
      }

      if (!container) return;

      const rect = container.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.7 && 
                           rect.height > window.innerHeight * 0.7;
      
      if (!isFullScreen) return;

      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      if (allVideos.length === 0) return;

      allVideos.forEach((video, index) => {
        const vid = video as HTMLVideoElement;
        if (index === 0) {
          container.appendChild(vid);
          vid.style.position = 'absolute';
          vid.style.top = '0';
          vid.style.left = '0';
          vid.style.width = '100%';
          vid.style.height = '100%';
          vid.style.objectFit = 'cover';
          vid.style.zIndex = '1';
        } else {
          vid.remove();
        }
      });
    };

    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 500);
    const timeouts = [100, 500, 1000, 2000].map(delay => 
      setTimeout(moveVideoToContainer, delay)
    );

    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, [previewContainerId]);

  // Show completion screen
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.totalMatches}
        total={requiredRounds * 5}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          clearScheduledSpeech();
          Speech.stop();
          onComplete?.();
        }}
        onHome={() => {
          clearScheduledSpeech();
          Speech.stop();
          onBack();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.playArea}>
        {/* Full Screen Camera Preview */}
        {hasCamera && (
          <View style={styles.fullScreenCamera}>
            {Platform.OS === 'web' ? (
              <View
                ref={previewRef}
                style={[
                  StyleSheet.absoluteFill, 
                  { 
                    backgroundColor: '#000000',
                  }
                ]}
                nativeID={previewContainerId}
                collapsable={false}
              >
                {!isDetecting && (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 16 }}>Loading camera...</Text>
                  </View>
                )}
              </View>
            ) : (
              jawDetection.device && Camera && (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={jawDetection.device}
                  isActive={gameState === 'playing' || gameState === 'calibration'}
                  frameProcessor={jawDetection.frameProcessor}
                  frameProcessorFps={30}
                />
              )
            )}
          </View>
        )}

        {/* Overlay UI Elements */}
        <View style={styles.overlayContainer}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </Pressable>
        <Text style={styles.headerText}>Round {currentRound} / {requiredRounds}</Text>
        <View style={styles.starsContainer}>
          {[1, 2, 3].map(i => (
            <Ionicons
              key={i}
              name="star"
              size={20}
              color={i <= totalStars ? '#FFD700' : '#CCC'}
            />
          ))}
        </View>
      </View>

      {/* Game content */}
      {gameState === 'calibration' && (
        <View style={styles.centerContent}>
          <Text style={styles.instructionText}>
            {jawError || !hasCamera
              ? 'Waiting for camera...'
              : isDetecting
              ? 'Great! Now get ready to match patterns!'
              : 'Show your face to the camera'}
          </Text>
          {jawError && (
            <Text style={styles.errorText}>{jawError}</Text>
          )}
        </View>
      )}

      {gameState === 'countdown' && (
        <View style={styles.centerContent}>
          <Text style={styles.countdownText}>{countdown || 'Go!'}</Text>
        </View>
      )}

      {gameState === 'playing' && (
        <View style={styles.gameArea}>
          {/* Target pattern */}
          <View style={styles.targetContainer}>
            <Text style={styles.targetLabel}>Match this pattern:</Text>
            <View style={styles.tilesRow}>
              {targetPattern.tiles.map((tile, index) => (
                <View
                  key={index}
                  style={[
                    styles.tile,
                    styles.targetTile,
                    { backgroundColor: tile === 'open' ? '#4CAF50' : '#F44336' },
                  ]}
                >
                  <Text style={styles.tileText}>
                    {tile === 'open' ? 'O' : 'C'}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Selected tiles */}
          <View style={styles.selectedContainer}>
            <Text style={styles.selectedLabel}>
              {isVerifying ? 'Perform the pattern:' : 'Your tiles:'}
            </Text>
            <View style={styles.tilesRow}>
              {selectedTiles.map((tile, index) => (
                <View
                  key={index}
                  style={[
                    styles.tile,
                    {
                      backgroundColor: isVerifying && index === verificationStep
                        ? '#FFD700'
                        : tile === 'open'
                        ? '#4CAF50'
                        : '#F44336',
                    },
                  ]}
                >
                  <Text style={styles.tileText}>
                    {tile === 'open' ? 'O' : 'C'}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Tile selection buttons */}
          {!isVerifying && (
            <View style={styles.buttonContainer}>
              <Pressable
                style={[styles.tileButton, { backgroundColor: '#4CAF50' }]}
                onPress={() => handleTileSelect('open')}
              >
                <Text style={styles.buttonText}>OPEN</Text>
              </Pressable>
              <Pressable
                style={[styles.tileButton, { backgroundColor: '#F44336' }]}
                onPress={() => handleTileSelect('closed')}
              >
                <Text style={styles.buttonText}>CLOSE</Text>
              </Pressable>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>Matches: {matches}</Text>
          </View>

          {/* Time remaining */}
          <View style={styles.timeContainer}>
            <Text style={styles.timeText}>
              {Math.max(0, Math.ceil(ROUND_TIME_MS / 1000 - timeElapsed))}s
            </Text>
          </View>
        </View>
      )}

      {showRoundSuccess && (
        <RoundSuccessAnimation
          stars={roundResults[roundResults.length - 1]?.stars || 0}
          onAnimationComplete={() => {}}
        />
      )}

      {/* Round complete overlay */}
      {gameState === 'roundComplete' && !showRoundSuccess && (
        <View style={styles.overlay}>
          <Text style={styles.roundCompleteText}>
            Round {currentRound} Complete!
          </Text>
        </View>
      )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playArea: {
    flex: 1,
    position: 'relative',
  },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: '#000',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
  },
  headerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  instructionText: {
    fontSize: 20,
    textAlign: 'center',
    color: '#333',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#FF0000',
    marginTop: 10,
    textAlign: 'center',
  },
  countdownText: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#333',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  targetContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  targetLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  selectedContainer: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  selectedLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  tilesRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  tile: {
    width: 60,
    height: 60,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#333',
  },
  targetTile: {
    borderColor: '#FFD700',
    borderWidth: 4,
  },
  tileText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  buttonContainer: {
    position: 'absolute',
    top: '60%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    zIndex: 6,
  },
  tileButton: {
    width: 120,
    height: 60,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#333',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  statsContainer: {
    position: 'absolute',
    top: 100,
    right: 20,
    alignItems: 'center',
    zIndex: 6,
  },
  statsText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  timeContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  timeText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFF',
  },
});

