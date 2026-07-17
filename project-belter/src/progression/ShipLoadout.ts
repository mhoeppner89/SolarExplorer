import { moduleDefinitions, type ModuleId } from '../data/gameData';

export interface AggregatedShipStats {
  dryMass: number;
  cargoCapacity: number;
  forwardThrust: number;
  reverseThrust: number;
  rotationalAcceleration: number;
  fuelUseMultiplier: number;
}

export interface BaseShipStats {
  dryMass: number;
  cargoCapacity: number;
  forwardThrust: number;
  reverseThrust: number;
  rotationalAcceleration: number;
}

export const aggregateShipStats = (
  base: BaseShipStats,
  installedModules: readonly ModuleId[],
): AggregatedShipStats => {
  let dryMass = base.dryMass;
  let cargoCapacity = base.cargoCapacity;
  let forwardThrust = base.forwardThrust;
  let reverseThrust = base.reverseThrust;
  let rotationalAcceleration = base.rotationalAcceleration;
  let fuelUseMultiplier = 1;

  for (const moduleId of installedModules) {
    const module = moduleDefinitions[moduleId];
    dryMass += module.massAdd;
    cargoCapacity += module.cargoCapacityAdd;
    forwardThrust *= module.forwardThrustMultiplier;
    reverseThrust *= module.reverseThrustMultiplier;
    rotationalAcceleration *= module.rotationalAccelerationMultiplier;
    fuelUseMultiplier *= module.fuelUseMultiplier;
  }

  return {
    dryMass,
    cargoCapacity,
    forwardThrust,
    reverseThrust,
    rotationalAcceleration,
    fuelUseMultiplier,
  };
};
