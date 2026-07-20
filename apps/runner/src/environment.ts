import { type LauncherConfig, parseLauncherEnvironment } from './launcher-environment.js'

export const parseLauncherProcessEnvironment = (): LauncherConfig =>
  parseLauncherEnvironment(process.env)
