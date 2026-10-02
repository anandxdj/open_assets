"""Original synthesized instrumental and UI sound design; no third-party samples."""
from pathlib import Path
import wave
import numpy as np

SR=48000
DURATION=40
rng=np.random.default_rng(23)
audio=np.zeros((SR*DURATION,2),dtype=np.float64)

def add(time,signal,gain=1,pan=0):
    start=int(time*SR)
    end=min(len(audio),start+len(signal))
    if start<0 or end<=start:return
    sig=signal[:end-start]*gain
    audio[start:end,0]+=sig*np.sqrt((1-pan)/2)
    audio[start:end,1]+=sig*np.sqrt((1+pan)/2)

def note(freq,length=.4):
    t=np.arange(int(SR*length))/SR
    env=(1-np.exp(-t*100))*np.exp(-t*8)
    return (np.sin(2*np.pi*freq*t)+.23*np.sin(2*np.pi*freq*2*t)+.1*np.sin(2*np.pi*freq*3*t))*env

# 96 BPM. Low, restrained pulse with soft electric-key arpeggios.
beat=60/96
chords=[[146.83,185,220,293.66],[130.81,164.81,196,261.63],[110,138.59,164.81,220],[130.81,164.81,196,261.63]]
for b in range(64):
    when=b*beat
    chord=chords[(b//8)%4]
    t=np.arange(int(SR*.23))/SR
    kick=np.sin(2*np.pi*(48*t+4*(1-np.exp(-t*22))))*np.exp(-t*19)
    add(when,kick,.14)
    if b%2==1:
        n=rng.normal(0,1,len(t)); clap=(n-np.roll(n,1))*np.exp(-t*35)
        add(when,clap,.018,.13)
    for sub in range(2):
        tm=when+sub*beat/2
        add(tm,note(chord[(b*2+sub)%4]*2,.5),.07,(-.28 if sub==0 else .28))
    add(when,note(chord[0]/2,.6),.11)
    th=np.arange(int(SR*.07))/SR
    noise=rng.normal(0,1,len(th));hat=(noise-np.roll(noise,1))*np.exp(-th*70)
    add(when+beat/2,hat,.006,-.2)

# Low ambient chord beds.
for block in range(10):
    t=np.arange(int(SR*4))/SR
    chord=chords[block%4]
    pad=sum(np.sin(2*np.pi*x*t) for x in chord)/4
    env=np.sin(np.pi*np.minimum(t/4,1))**2
    add(block*4,pad*env,.035)

# Transitions and discrete crop / naming confirmation ticks.
for sec in [5,10,17,24,31,35]:
    t=np.arange(int(SR*.32))/SR
    env=np.sin(np.pi*t/.32)**2
    n=rng.normal(0,1,len(t))
    noise=np.convolve(n,np.ones(16)/16,mode='same')
    add(sec-.22,noise*env,.055)
for i in range(6):
    add(10.8+i*.3,note(780+i*55,.14),.035,(i-2.5)/8)
    add(18.7+i*.43,note(520+i*40,.2),.035,(i-2.5)/8)
for t0 in [6.9,28.1,33.1]:
    add(t0,note(659.25,.55),.08,-.1)
    add(t0+.10,note(987.77,.6),.06,.1)

fade=np.ones(len(audio))
fade[:SR]=np.linspace(0,1,SR)
fade[-SR*2:]=np.linspace(1,0,SR*2)
audio*=fade[:,None]
audio=np.tanh(audio*1.8)*.65
Path('public').mkdir(exist_ok=True)
with wave.open('public/soundtrack.wav','wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
    f.writeframes((audio*32767).astype('<i2').tobytes())
print('Original 40-second stereo soundtrack generated.')
