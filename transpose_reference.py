"""Transpose the local Krishna reference while keeping its score timeline."""
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft, istft, resample

rate, pcm = wavfile.read(sys.argv[1])
ratio = float(sys.argv[2])
signal = pcm.astype(np.float64) / 32768
size, hop = 1024, 256
_, _, spectrum = stft(signal, fs=rate, nperseg=size, noverlap=size-hop)
positions = np.arange(0, spectrum.shape[1]-1, 1/ratio)
indices = positions.astype(int)
fraction = positions-indices
magnitude = abs(spectrum[:,indices])*(1-fraction)+abs(spectrum[:,indices+1])*fraction
advance = (2*np.pi*hop/size*np.arange(spectrum.shape[0]))[:,None]
angles = np.angle(spectrum)
delta = angles[:,indices+1]-angles[:,indices]-advance
increments = advance + (delta+np.pi)%(2*np.pi)-np.pi
phase = np.cumsum(np.column_stack((angles[:,0], increments[:,:-1])),axis=1)
_, stretched = istft(magnitude*np.exp(1j*phase),fs=rate,nperseg=size,noverlap=size-hop)
result = resample(stretched,len(signal))
import io
data = io.BytesIO()
wavfile.write(data,rate,(np.clip(result,-1,.9999)*32768).astype('<i2'))
sys.stdout.buffer.write(data.getvalue())
