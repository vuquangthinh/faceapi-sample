import * as faceapi from 'face-api.js'

import logo from './logo.svg';
import './App.css';
import { useEffect, useLayoutEffect, useRef } from 'react';


// polyfill based on https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
(function polyfillGetUserMedia() {
  if (typeof window === 'undefined') {
    return;
  }

  // Older browsers might not implement mediaDevices at all, so we set an empty object first
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  // Some browsers partially implement mediaDevices. We can't just assign an object
  // with getUserMedia as it would overwrite existing properties.
  // Here, we will just add the getUserMedia property if it's missing.
  if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function (constraints) {
      // First get ahold of the legacy getUserMedia, if present
      const getUserMedia =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;

      // Some browsers just don't implement it - return a rejected promise with an error
      // to keep a consistent interface
      if (!getUserMedia) {
        return Promise.reject(
          new Error("getUserMedia is not implemented in this browser")
        );
      }

      // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
      return new Promise(function (resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    };
  }
})();


function hasGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}


const classes = ['Thịnh'];

const sound = {};

const sayHello = (label) => {
  if (classes.indexOf(label) >= 0) {
    console.log('hello: ', label);
    if (sound[label]) {
      playSound(sound[label]);
    } else {
      // playSound(sound[label]);
      // curl -X POST https://api.fpt.ai/hmi/tts/v5 -H "api-key: 272WXaNT6s3QpZrjhOjFkvuNWKvIyDwa" -H "speed: " -H "voice: banmai" -d "nội dung"
      fetch('https://api.fpt.ai/hmi/tts/v5', {
        method: 'POST', headers: {
          'api-key': '272WXaNT6s3QpZrjhOjFkvuNWKvIyDwa',
          'speed': '',
          'voice': 'banmai',
        },
        body: 'Xin chào' + label, // + " đẹp trai vãi nồi!",
      }).then(res => res.json())
        .then(sout => {
          sound[label] = sout.url;
          setTimeout(() => {
            // https://file01.fpt.ai/text2speech-v5/short/2024-03-15/e5dafee78d869fd87dfa088b10e65012.mp3
            // play sound
            playSound(sout.async);
          }, 5000);
        });
    }
  }
}

let playing = false;

const playSound = (url) => {
  if (playing) return;
  playing = true;
  setTimeout(() => {
    playing = false;
  }, 5000);

  var audio = new Audio(url);
  audio.play();
}

function getFaceImageUri(className, idx) {
  return `/users/${className}/${idx}.jpg`
}

function App() {

  const canvasRef = useRef();
  const videoRef = useRef();

  useEffect(() => {
    const handleResize = () => {
      const SCREEN_WIDTH = window.innerWidth;
      const SCREEN_HEIGHT = window.innerHeight;
      const canvas = canvasRef.current;
      canvas.width = SCREEN_WIDTH;
      canvas.height = SCREEN_HEIGHT;
    }

    window.addEventListener('resize', handleResize)
    handleResize();

    return () => window.removeEventListener('resize', handleResize)
  });

  useEffect(() => {

    // image from camera
    (async () => {
      if (!hasGetUserMedia()) return;

      const SCREEN_WIDTH = window.innerWidth
      const SCREEN_HEIGHT = window.innerHeight;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          aspectRatio: SCREEN_WIDTH / SCREEN_HEIGHT
        }, audio: false
      });

      const video = videoRef.current;
      video.srcObject = stream;

      video.width = SCREEN_WIDTH;
      video.height = SCREEN_HEIGHT;


      // fetch first image of each class and compute their descriptors

      await Promise.all([
        faceapi.loadSsdMobilenetv1Model('/weights'),
        faceapi.loadFaceLandmarkModel('/weights'),
        faceapi.loadFaceRecognitionModel('/weights'),
      ]);

      const createBbtFaceMatcher = async (numImagesForTraining = 2) => {
        const maxAvailableImagesPerClass = 5
        numImagesForTraining = Math.min(numImagesForTraining, maxAvailableImagesPerClass)

        const labeledFaceDescriptors = await Promise.all(classes.map(
          async className => {
            const descriptors = []
            for (let i = 1; i < (numImagesForTraining + 1); i++) {
              const img = await faceapi.fetchImage(getFaceImageUri(className, i))
              descriptors.push(await faceapi.computeFaceDescriptor(img))
            }

            return new faceapi.LabeledFaceDescriptors(
              className,
              descriptors
            )
          }
        ))

        return new faceapi.FaceMatcher(labeledFaceDescriptors)
      }

      const faceMatcher = await createBbtFaceMatcher();

      const getFaceDetectorOptions = () => {
        return new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      }

      const firstVisible = {};
      const nextHello = {};

      (function loop() {
        const ctx = canvasRef.current.getContext('2d');
        ctx.drawImage(video, 0, 0);

        (async () => {
          const detections = await faceapi.detectAllFaces(canvasRef.current).withFaceLandmarks().withFaceDescriptors();
          const resizedDetections = faceapi.resizeResults(detections, canvasRef.current)

          const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
          // nếu chưa xuất hiện
          results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box
            const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() })
            drawBox.draw(canvasRef.current);

            if (!firstVisible[result.label]) {
              firstVisible[result.label] = Date.now();
            }
          });

          Object.keys(firstVisible).forEach(label => {
            const found = results.find(r => r.label === label);

            // hiện tại không thấy và thấy hơn 10s trước
            if (!found && Date.now() - firstVisible[label] > 10000) {
              delete firstVisible[label]; // không thấy và lần gặp cuối lâu hơn 30s
              delete nextHello[label];
            }
          });

          Object.keys(firstVisible).forEach(label => {
            if (firstVisible[label]) {
              if (!nextHello[label] || Date.now() - nextHello[label] > 10000) {
                // đã chào
                nextHello[label] = Date.now() + 10000;
                console.log('Chào lại lần tới:' + label);
                sayHello(label);
              }
            }
          });

          // Object.keys(firstVisible).forEach(label => {
          //   if (Date.now() - firstVisible[label] < 30000) {
          //     if (Date.now() - lastHello[label] < 30000) {
          //       // OK, no hi
          //       console.log('Chào lại lần tới:' + label);
          //     } else {
          //       sayHello(label);
          //       lastHello[label] = Date.now(); 
          //     }
          //   }
          // })

          // const detectionWithLandmarks = await faceapi.detectSingleFace(canvasRef.current).withFaceLandmarks()
          // console.log(detectionWithLandmarks);
        })();

        setTimeout(loop, 1000 / 30); // drawing at 30fps
      })();

      // const detection = await faceapi.detectSingleFace(input)
    })();
  }, []);

  return (
    <>
      <canvas ref={canvasRef} width="100%" height="100%" />
      <video ref={videoRef} autoPlay style={{ display: 'none' }} />
    </>
  );
}

export default App;
