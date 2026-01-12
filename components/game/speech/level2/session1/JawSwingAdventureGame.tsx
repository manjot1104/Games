import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import type { MouthLandmarks } from '@/hooks/useJawDetectionWeb';
import { logGameAndAward } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';

// Conditional import for VisionCamera
let Camera: any = null;
if (Platform.OS !== 'web') {
  try {
    const visionCamera = require('react-native-vision-camera');
    Camera = visionCamera.Camera;
  } catch (e) {
    console.warn('react-native-vision-camera not available:', e);
  }
}

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const DEFAULT_TTS_RATE = 0.75;
const ROUND_DURATION_MS = 5000; // 5 seconds per round
const TOTAL_ROUNDS = 6;
const COLLECTION_THRESHOLD = 0.3; // Distance threshold for collecting items

// Responsive sizing
const getResponsiveSize = (baseSize: number, isTablet: boolean, isMobile: boolean) => {
  if (isTablet) return baseSize * 1.3;
  if (isMobile) return baseSize * 0.9;
  return baseSize;
};

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

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

/**
 * Draw mouth landmarks on canvas overlay (web only)
 */
function drawLandmarks(canvas: HTMLCanvasElement, landmarks: MouthLandmarks) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const container = canvas.parentElement;
  if (!container) return;
  
  const video = container.querySelector('video') as HTMLVideoElement;
  
  // Use video dimensions if available, otherwise use canvas dimensions (normalized coordinates)
  let videoWidth = video?.videoWidth || canvas.width;
  let videoHeight = video?.videoHeight || canvas.height;
  const scaleX = canvas.width / videoWidth;
  const scaleY = canvas.height / videoHeight;

  // Draw all mouth landmarks as subtle points
  if (landmarks.allMouthLandmarks) {
    ctx.strokeStyle = '#FF6B6B';
    ctx.fillStyle = '#FF6B6B';
    ctx.lineWidth = 1.5;

    landmarks.allMouthLandmarks.forEach((point) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // Draw upper lip line
  if (landmarks.upperLip.length > 0) {
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    landmarks.upperLip.forEach((point, index) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // Draw lower lip line
  if (landmarks.lowerLip.length > 0) {
    ctx.strokeStyle = '#45B7D1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    landmarks.lowerLip.forEach((point, index) => {
      const x = point.x * videoWidth * scaleX;
      const y = point.y * videoHeight * scaleY;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // Draw mouth opening indicator
  if (landmarks.upperLip.length > 0 && landmarks.lowerLip.length > 0) {
    const upperCenter = landmarks.upperLip[Math.floor(landmarks.upperLip.length / 2)];
    const lowerCenter = landmarks.lowerLip[Math.floor(landmarks.lowerLip.length / 2)];
    
    ctx.strokeStyle = '#FFD93D';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(upperCenter.x * videoWidth * scaleX, upperCenter.y * videoHeight * scaleY);
    ctx.lineTo(lowerCenter.x * videoWidth * scaleX, lowerCenter.y * videoHeight * scaleY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

type TargetDirection = 'left' | 'right' | 'center';

export const JawSwingAdventureGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = TOTAL_ROUNDS,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const isTablet = SCREEN_WIDTH >= 768;
  const isMobile = SCREEN_WIDTH < 600;
  
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctMatches: number;
    matchAccuracy: number;
    itemsCollected: number;
    attentionScore: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Game state
  const [canPlay, setCanPlay] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [targetDirection, setTargetDirection] = useState<TargetDirection>('center');
  const [itemsCollected, setItemsCollected] = useState(0);
  const [score, setScore] = useState(0);
  
  // Scoring
  const [correctMatches, setCorrectMatches] = useState(0);
  const [matchFrames, setMatchFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  
  // Jaw detection
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : canPlay);
  const { 
    lateralPosition, 
    lateralAmount, 
    isDetecting, 
    hasCamera, 
    error: jawError,
    previewContainerId,
    landmarks 
  } = jawDetection;
  
  // Refs
  const canPlayRef = useRef<boolean>(false);
  const currentLateralPositionRef = useRef<'left' | 'center' | 'right'>('center');
  const characterPositionRef = useRef(new Animated.Value(SCREEN_WIDTH / 2)).current;
  const characterPositionCurrentRef = useRef<number>(SCREEN_WIDTH / 2);
  const itemsRef = useRef<{ id: number; x: number; direction: TargetDirection; collected: boolean }[]>([]);
  const gameStartedRef = useRef(false);
  
  // Animations
  const characterScale = useRef(new Animated.Value(1)).current;
  const characterOpacity = useRef(new Animated.Value(0)).current;
  const backgroundScroll = useRef(new Animated.Value(0)).current;
  const itemScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const roundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const matchCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previewRef = useRef<View>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync refs
  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);
  
  useEffect(() => {
    if (lateralPosition) {
      currentLateralPositionRef.current = lateralPosition;
    }
  }, [lateralPosition]);

  // Track character position with listener
  useEffect(() => {
    const listener = characterPositionRef.addListener(({ value }) => {
      characterPositionCurrentRef.current = value;
    });
    return () => {
      characterPositionRef.removeListener(listener);
    };
  }, [characterPositionRef]);

  // Update character position based on jaw lateral position
  useEffect(() => {
    if (!canPlay) return;
    
    const targetX = SCREEN_WIDTH / 2 + (lateralAmount || 0) * (SCREEN_WIDTH / 3);
    Animated.spring(characterPositionRef, {
      toValue: Math.max(50, Math.min(SCREEN_WIDTH - 50, targetX)),
      tension: 50,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [lateralAmount, canPlay, SCREEN_WIDTH]);

  // Update canvas when landmarks change (web only) - use animation frame for smooth updates
  useEffect(() => {
    if (Platform.OS !== 'web' || !landmarks) return;
    
    let animationFrameId: number;
    
    const draw = () => {
      // Always try to find container and canvas on each frame (in case they're created later)
      let container: HTMLElement | null = null;
      
      // Method 1: Find via video element parent
      const videoElement = document.querySelector('video[data-jaw-preview-video]') as HTMLVideoElement;
      if (videoElement?.parentElement) {
        container = videoElement.parentElement as HTMLElement;
      }
      
      // Method 2: Find via data-native-id
      if (!container) {
        container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      }
      
      // Method 3: Find via nativeID
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      
      if (!container) {
        // Container not found yet, keep trying
        animationFrameId = requestAnimationFrame(draw);
        return;
      }
      
      // Get or create canvas
      let canvas = container.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '100';
        canvas.style.borderRadius = '0';
        canvas.style.backgroundColor = 'transparent';
        container.appendChild(canvas);
        canvasRef.current = canvas;
      }
      
      // Update canvas size if container size changed
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        // Only resize if dimensions actually changed to avoid unnecessary redraws
        if (canvas.width !== container.offsetWidth || canvas.height !== container.offsetHeight) {
          canvas.width = container.offsetWidth;
          canvas.height = container.offsetHeight;
        }
      }
      
      // Redraw landmarks on every frame
      try {
        if (canvas && landmarks) {
          drawLandmarks(canvas, landmarks);
        }
      } catch (error) {
        console.warn('Error drawing landmarks:', error);
      }
      
      animationFrameId = requestAnimationFrame(draw);
    };
    
    draw();
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [landmarks, previewContainerId]);

  // Ensure container has data-native-id attribute for hook to find it (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;
    
    const setAttribute = () => {
      try {
        // Try to find container by nativeID first
        let element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        
        // If not found, try data-native-id
        if (!element) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        
        // If still not found, try via ref
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.current || 
                              (previewRef.current as any)?.base || 
                              previewRef.current;
            if (refElement && refElement.nodeType === 1) {
              element = refElement;
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Set data-native-id attribute if element found and doesn't have it
        if (element && !element.getAttribute('data-native-id')) {
          element.setAttribute('data-native-id', previewContainerId);
        }
      } catch (e) {
        // Silently fail - hook will try other methods
      }
    };
    
    // Try immediately and with delays to catch element when mounted
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
      // Find our full-screen container
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      
      // Also try by nativeID attribute
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      
      // Also try to find it via the ref
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.current || 
                            (previewRef.current as any)?.base || 
                            previewRef.current;
          if (refElement && refElement.nodeType === 1) {
            container = refElement;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!container) return;

      // Validate container is full-screen (must be >70% of screen size)
      const rect = container.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.7 && 
                           rect.height > window.innerHeight * 0.7;
      
      if (!isFullScreen) {
        // Not the right container, keep looking
        return;
      }

      // Find all video elements with the preview attribute
      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      
      let videoInContainer: HTMLVideoElement | null = null;
      const videosToRemove: HTMLVideoElement[] = [];
      
      allVideos.forEach((video) => {
        const videoElement = video as HTMLVideoElement;
        if (container.contains(videoElement)) {
          videoInContainer = videoElement;
        } else {
          // Video is in wrong container - mark for removal
          videosToRemove.push(videoElement);
        }
      });

      // If no video in our container, move the first one we find
      if (!videoInContainer && allVideos.length > 0) {
        const videoToMove = allVideos[0] as HTMLVideoElement;
        // Remove from current parent (check if it's actually a child first)
        if (videoToMove.parentElement && videoToMove.parentElement.contains(videoToMove)) {
          videoToMove.parentElement.removeChild(videoToMove);
        }
        // Add to our container
        container.appendChild(videoToMove);
        videoInContainer = videoToMove;
      }

      // Remove duplicate videos (check if they're actually children first)
      videosToRemove.forEach(video => {
        if (video.parentElement && video.parentElement.contains(video)) {
          video.parentElement.removeChild(video);
        }
      });

      // Ensure video in our container is properly styled
      if (videoInContainer) {
        videoInContainer.style.display = 'block';
        videoInContainer.style.position = 'absolute';
        videoInContainer.style.opacity = '1';
        videoInContainer.style.width = '100%';
        videoInContainer.style.height = '100%';
        videoInContainer.style.objectFit = 'cover';
        videoInContainer.style.top = '0';
        videoInContainer.style.left = '0';
        videoInContainer.style.right = '0';
        videoInContainer.style.bottom = '0';
        videoInContainer.style.zIndex = '1';
        videoInContainer.style.borderRadius = '0';
      }

      // Ensure container is full screen and visible
      (container as any).style.position = 'absolute';
      (container as any).style.top = '0';
      (container as any).style.left = '0';
      (container as any).style.right = '0';
      (container as any).style.bottom = '0';
      (container as any).style.width = '100%';
      (container as any).style.height = '100%';
      (container as any).style.zIndex = '1';
      (container as any).style.display = 'block';
      (container as any).style.visibility = 'visible';
      (container as any).style.opacity = '1';
    };

    // Run immediately and periodically (increased frequency to 200ms)
    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 200);

    return () => clearInterval(interval);
  }, [previewContainerId, hasCamera, previewRef]);

  // Check for item collection
  useEffect(() => {
    if (!canPlay || !lateralPosition) return;
    
    const checkCollection = () => {
      const characterX = characterPositionCurrentRef.current;
      itemsRef.current.forEach((item, index) => {
        if (!item.collected && Math.abs(item.x - characterX) < COLLECTION_THRESHOLD * SCREEN_WIDTH) {
          // Check if direction matches
          if (item.direction === lateralPosition || 
              (item.direction === 'center' && lateralPosition === 'center')) {
            item.collected = true;
            setItemsCollected(prev => prev + 1);
            setScore(prev => prev + 10);
            
            // Celebration animation
            Animated.sequence([
              Animated.parallel([
                Animated.spring(itemScale, {
                  toValue: 1.5,
                  tension: 50,
                  friction: 7,
                  useNativeDriver: true,
                }),
                Animated.timing(celebrationOpacity, {
                  toValue: 1,
                  duration: 200,
                  useNativeDriver: true,
                }),
              ]),
              Animated.parallel([
                Animated.spring(itemScale, {
                  toValue: 1,
                  tension: 50,
                  friction: 7,
                  useNativeDriver: true,
                }),
                Animated.timing(celebrationOpacity, {
                  toValue: 0,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]),
            ]).start();
            
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } catch {}
          }
        }
      });
    };
    
    const interval = setInterval(checkCollection, 100);
    return () => clearInterval(interval);
  }, [canPlay, lateralPosition, SCREEN_WIDTH]);

  const finishGame = useCallback(async () => {
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (matchCheckIntervalRef.current) {
      clearInterval(matchCheckIntervalRef.current);
      matchCheckIntervalRef.current = null;
    }
    if (gameStartTimeoutRef.current) {
      clearTimeout(gameStartTimeoutRef.current);
      gameStartTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    clearScheduledSpeech();

    const totalRounds = currentRound > 0 ? currentRound : 1;
    const matchAccuracy = totalFrames > 0 ? (matchFrames / totalFrames) * 100 : 0;
    const attentionScore = Math.min(100, Math.round(matchAccuracy * 0.6 + (itemsCollected / (totalRounds * 3)) * 40));
    const xp = correctMatches * 50 + itemsCollected * 5;

    setFinalStats({
      totalRounds,
      correctMatches,
      matchAccuracy,
      itemsCollected,
      attentionScore,
      xpAwarded: xp,
    });

    try {
      await logGameAndAward({
        type: 'jaw-swing-adventure',
        correct: correctMatches,
        total: totalRounds,
        accuracy: matchAccuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['jaw-awareness', 'jaw-lateral', 'oral-motor-control', 'coordination'],
        incorrectAttempts: totalRounds - correctMatches,
        meta: {
          itemsCollected,
          matchAccuracy,
          attentionScore,
        },
      });
      onComplete?.();
    } catch (e) {
      console.warn('Failed to save game log:', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [correctMatches, currentRound, matchFrames, totalFrames, itemsCollected, onComplete]);

  const startRound = useCallback(() => {
    setCurrentRound(prev => {
      const nextRound = prev + 1;
      if (nextRound > requiredRounds) {
        finishGame();
        return prev;
      }
      return nextRound;
    });
    
    // Reset items for new round
    itemsRef.current = [];
    
    // Generate target direction and items
    const directions: TargetDirection[] = ['left', 'right', 'center'];
    const targetDir = directions[Math.floor(Math.random() * directions.length)];
    setTargetDirection(targetDir);
    
    // Generate collectible items
    for (let i = 0; i < 3; i++) {
      const itemDirection = directions[Math.floor(Math.random() * directions.length)];
      const itemX = 100 + (SCREEN_WIDTH - 200) * Math.random();
      itemsRef.current.push({
        id: Date.now() + i,
        x: itemX,
        direction: itemDirection,
        collected: false,
      });
    }
    
    speak(`Move your jaw ${targetDir === 'left' ? 'left' : targetDir === 'right' ? 'right' : 'to center'}!`);
    
    // Animate background scroll
    Animated.loop(
      Animated.timing(backgroundScroll, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();

    // Check matches during round
    let isRoundActive = true;
    const checkMatches = () => {
      if (isRoundActive && canPlayRef.current) {
        const currentPos = currentLateralPositionRef.current;
        setTotalFrames(prev => prev + 1);
        
        if (currentPos === targetDir) {
          setMatchFrames(prev => prev + 1);
        }
      }
    };

    matchCheckIntervalRef.current = setInterval(checkMatches, 100) as unknown as NodeJS.Timeout;

    // After ROUND_DURATION_MS, check results and start next round
    roundTimeoutRef.current = (setTimeout(() => {
      isRoundActive = false;
      if (matchCheckIntervalRef.current) {
        clearInterval(matchCheckIntervalRef.current);
        matchCheckIntervalRef.current = null;
      }

      const matchRate = totalFrames > 0
        ? matchFrames / totalFrames
        : 0;
      
      // Show success animation instead of TTS
      if (matchRate >= 0.6) {
        setCorrectMatches(prev => prev + 1);
        setShowRoundSuccess(true);
        
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }

      // Update progress
      setCurrentRound(prevRound => {
        Animated.timing(progressBarWidth, {
          toValue: (prevRound / requiredRounds) * 100,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }).start();
        return prevRound;
      });

      // Start next round
      setTimeout(() => {
        setShowRoundSuccess(false);
        startRound();
      }, 2500);
    }, ROUND_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [requiredRounds, finishGame, progressBarWidth, SCREEN_WIDTH]);

  const startGame = useCallback(() => {
    if (gameStartedRef.current) return;
    
    if (!hasCamera) {
      if (Platform.OS === 'web') {
        const checkCamera = (attempts = 0) => {
          if (hasCamera) {
            gameStartedRef.current = true;
            setCanPlay(true);
            speak('Move your jaw left and right to control the character!');
          } else if (jawError) {
            speak('Camera access denied. Please allow camera access and refresh the page.');
          } else if (attempts < 5) {
            setTimeout(() => checkCamera(attempts + 1), 1000);
          } else {
            speak('Camera not available. Please check your browser permissions.');
          }
        };
        setTimeout(() => checkCamera(), 500);
        return;
      } else {
        speak('Camera not available. Please use a dev build.');
        return;
      }
    }

    gameStartedRef.current = true;
    setCanPlay(true);
    speak('Move your jaw left and right to control the character!');
    
    Animated.parallel([
      Animated.spring(characterScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(characterOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    gameStartTimeoutRef.current = (setTimeout(() => {
      startRound();
    }, 2000)) as unknown as NodeJS.Timeout;
  }, [hasCamera, jawError, startRound]);

  useEffect(() => {
    if (hasCamera && !gameStartedRef.current) {
      startGame();
    } else if (!hasCamera && Platform.OS === 'web' && !jawError) {
      const timeout = setTimeout(() => {
        if (hasCamera && !gameStartedRef.current) {
          startGame();
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [hasCamera, jawError, startGame]);

  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
      if (matchCheckIntervalRef.current) clearInterval(matchCheckIntervalRef.current);
      if (gameStartTimeoutRef.current) clearTimeout(gameStartTimeoutRef.current);
    };
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.correctMatches}
        total={finalStats.totalRounds}
        accuracy={finalStats.matchAccuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const matchAccuracy = totalFrames > 0 ? (matchFrames / totalFrames) * 100 : 0;
  const characterSize = getResponsiveSize(80, isTablet, isMobile);
  const itemSize = getResponsiveSize(40, isTablet, isMobile);

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
                    isActive={canPlay}
                    frameProcessor={jawDetection.frameProcessor}
                    frameProcessorFps={30}
                  />
                )
              )}
            </View>
          )}

          {/* Overlay UI Elements */}
          <View style={styles.overlayContainer}>
            {/* Error Message */}
            {jawError && (
              <View style={[styles.errorBanner, isMobile && styles.errorBannerMobile]}>
                <Ionicons name="alert-circle" size={24} color="#EF4444" />
                <Text style={styles.errorText}>{jawError}</Text>
              </View>
            )}

            {/* Position Indicator - Top Right */}
            {hasCamera && canPlay && (
              <View style={styles.positionIndicatorOverlay}>
                <View style={[
                  styles.positionIndicator,
                  lateralPosition === 'left' ? styles.positionLeft :
                  lateralPosition === 'right' ? styles.positionRight :
                  styles.positionCenter
                ]}>
                  <Text style={styles.positionText}>
                    {lateralPosition === 'left' ? '← LEFT' :
                     lateralPosition === 'right' ? 'RIGHT →' :
                     'CENTER'}
                  </Text>
                </View>
              </View>
            )}

            {/* Progress Bar - Top Center */}
            {canPlay && (
              <View style={[styles.progressBarContainer, isMobile && styles.progressBarContainerMobile]}>
                <View style={styles.progressBarBackground}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: progressBarWidth.interpolate({
                          inputRange: [0, 100],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, isMobile && styles.progressTextMobile]}>
                  Round {currentRound} / {requiredRounds}
                </Text>
              </View>
            )}

            {/* Game Area - Overlay */}
            <View style={styles.gameArea}>
            {/* Scrolling Background */}
            <Animated.View
              style={[
                styles.background,
                {
                  transform: [{
                    translateX: backgroundScroll.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -SCREEN_WIDTH],
                    }),
                  }],
                },
              ]}
            >
              <View style={[styles.background, { left: SCREEN_WIDTH }]} />
            </Animated.View>

            {/* Target Direction Indicator */}
            {canPlay && (
              <View style={styles.targetIndicator}>
                <Text style={[styles.targetText, isMobile && styles.targetTextMobile]}>
                  Move {targetDirection === 'left' ? '← LEFT' : targetDirection === 'right' ? 'RIGHT →' : 'CENTER'}
                </Text>
              </View>
            )}

            {/* Character */}
            <Animated.View
              style={[
                styles.character,
                {
                  left: characterPositionRef,
                  width: characterSize,
                  height: characterSize,
                  transform: [
                    { scale: characterScale },
                  ],
                  opacity: characterOpacity,
                },
              ]}
            >
              <Text style={[styles.characterEmoji, { fontSize: characterSize * 0.8 }]}>🦸</Text>
            </Animated.View>

            {/* Collectible Items */}
            {itemsRef.current.map((item, index) => (
              <Animated.View
                key={item.id}
                style={[
                  styles.item,
                  {
                    left: item.x,
                    top: SCREEN_HEIGHT * 0.4 + (index % 3) * 60,
                    width: itemSize,
                    height: itemSize,
                    transform: [{ scale: item.collected ? itemScale : 1 }],
                    opacity: item.collected ? 0 : 1,
                  },
                ]}
              >
                <Text style={[styles.itemEmoji, { fontSize: itemSize * 0.7 }]}>
                  {item.direction === 'left' ? '💎' : item.direction === 'right' ? '⭐' : '🌟'}
                </Text>
              </Animated.View>
            ))}

            {/* Celebration Effect */}
            <Animated.View
              style={[
                styles.celebration,
                {
                  opacity: celebrationOpacity,
                },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.celebrationText}>✨ Great! ✨</Text>
            </Animated.View>
          </View>

            {/* Stats - Bottom Overlay */}
            <View style={[styles.statsContainer, isMobile && styles.statsContainerMobile]}>
              <Text style={[styles.statsText, isMobile && styles.statsTextMobile]}>
                Score: {score} • Items: {itemsCollected}
              </Text>
              <Text style={[styles.statsSubtext, isMobile && styles.statsSubtextMobile]}>
                Accuracy: {Math.round(matchAccuracy)}% • Round {currentRound} / {requiredRounds}
              </Text>
            </View>
          </View>

          {/* Header Overlay */}
          <View style={styles.headerOverlay}>
            <Pressable
              onPress={() => {
                clearScheduledSpeech();
                onBack();
              }}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
              <Text style={styles.backTextOverlay}>Back</Text>
            </Pressable>
            <View style={styles.headerTextOverlay}>
              <Text style={[styles.titleOverlay, isMobile && styles.titleOverlayMobile]}>Jaw Swing Adventure</Text>
              <Text style={[styles.subtitleOverlay, isMobile && styles.subtitleOverlayMobile]}>
                {canPlay ? 'Move your jaw left and right!' : 'Get ready...'}
              </Text>
            </View>
          </View>

          {/* Skills Footer Overlay */}
          <View style={[styles.skillsContainerOverlay, isMobile && styles.skillsContainerOverlayMobile]}>
            <View style={styles.skillItem}>
              <Ionicons name="medical" size={isMobile ? 18 : 20} color="#FFFFFF" />
              <Text style={[styles.skillTextOverlay, isMobile && styles.skillTextOverlayMobile]}>Jaw Lateral</Text>
            </View>
            <View style={styles.skillItem}>
              <Ionicons name="move" size={isMobile ? 18 : 20} color="#FFFFFF" />
              <Text style={[styles.skillTextOverlay, isMobile && styles.skillTextOverlayMobile]}>Coordination</Text>
            </View>
            <View style={styles.skillItem}>
              <Ionicons name="game-controller" size={isMobile ? 18 : 20} color="#FFFFFF" />
              <Text style={[styles.skillTextOverlay, isMobile && styles.skillTextOverlayMobile]}>Motor Control</Text>
            </View>
          </View>
        </View>

        {/* Round Success Animation */}
        <RoundSuccessAnimation
          visible={showRoundSuccess}
          stars={3}
        />
      </SafeAreaView>
    );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 20,
    paddingTop: Platform.OS === 'web' ? 8 : 40,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  backTextOverlay: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 4,
  },
  headerTextOverlay: {
    flex: 1,
  },
  titleOverlay: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  titleOverlayMobile: {
    fontSize: 20,
  },
  subtitleOverlay: {
    fontSize: 14,
    color: '#E2E8F0',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  subtitleOverlayMobile: {
    fontSize: 12,
  },
  playArea: {
    flex: 1,
    position: 'relative',
  },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: '#000000',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    pointerEvents: 'box-none', // Allow touches to pass through to camera
  },
  cameraPreview: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 10,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    alignItems: 'center',
  },
  positionIndicatorOverlay: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 20 : 80,
    right: 20,
    zIndex: 15,
    alignItems: 'flex-end',
  },
  positionIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  positionLeft: {
    backgroundColor: '#3B82F6',
  },
  positionRight: {
    backgroundColor: '#EF4444',
  },
  positionCenter: {
    backgroundColor: '#22C55E',
  },
  positionText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  errorBanner: {
    position: 'absolute',
    top: 40,
    width: '90%',
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EF4444',
    zIndex: 15,
    alignSelf: 'center',
  },
  errorBannerMobile: {
    top: 60,
    padding: 12,
    width: '95%',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    width: 300,
    alignItems: 'center',
    zIndex: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  progressBarContainerMobile: {
    top: 70,
    width: '90%',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  progressTextMobile: {
    fontSize: 12,
  },
  gameArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    pointerEvents: 'none', // Allow touches to pass through
  },
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent', // Transparent since camera is behind
  },
  targetIndicator: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
  },
  targetText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  targetTextMobile: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  character: {
    position: 'absolute',
    bottom: 150,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  characterEmoji: {
    textAlign: 'center',
  },
  item: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  itemEmoji: {
    textAlign: 'center',
  },
  celebration: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFD700',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  statsContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginHorizontal: 20,
  },
  statsContainerMobile: {
    bottom: 80,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statsTextMobile: {
    fontSize: 16,
  },
  statsSubtext: {
    fontSize: 14,
    color: '#E2E8F0',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statsSubtextMobile: {
    fontSize: 12,
  },
  skillsContainerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 20,
  },
  skillsContainerOverlayMobile: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    paddingTop: 8,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillTextOverlay: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 4,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  skillTextOverlayMobile: {
    fontSize: 10,
    marginTop: 2,
  },
});

