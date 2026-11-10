import { create } from 'zustand'
import { SAMPLE_CENTER } from '../data/sampleView.js'

export const INITIAL_VIEW_STATE = {
  longitude: SAMPLE_CENTER[0],
  latitude: SAMPLE_CENTER[1],
  zoom: 11,
  pitch: 0,
  bearing: 0,
}

/** Camera and cursor. Hot state: components must select the narrowest slice they need. */
export const useMapStore = create((set) => ({
  viewState: INITIAL_VIEW_STATE,
  setViewState: (viewState) => set({ viewState }),
  /** The view once the camera stopped moving: {bbox:[w,s,e,n], zoom}. Viewport-driven sources request data for it. */
  settled: null,
  setSettled: (settled) => set({ settled }),
  cursor: null, // {lon, lat} while the pointer is over the map
  setCursor: (cursor) => set({ cursor }),
  mapStatus: 'loading', // 'loading' | 'ready'
  setMapStatus: (mapStatus) => set({ mapStatus }),
}))
