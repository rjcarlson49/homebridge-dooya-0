import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { DooyaHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DooyaAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private shadeStates = {
    currentPosition: 100, // 0-100, 100 is fully open, 0 is fully closed
    targetPosition: 100,
    positionState: 2,     // 0 - decreasing, 1 - increasing, 2 - stopped
  }

  constructor(
    private readonly platform: DooyaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Dooya')
      .setCharacteristic(this.platform.Characteristic.Model, 'Shades')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '0000-0000');

    // get the WindowCovering service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.exampleDisplayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the CurrentPosition Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .on('get', this.getCurrentPos.bind(this)); // GET - bind to the `getCurrentPos` method below
    
    // register handlers for the TargetPosition Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)!
      .on('get', this.getTargetPos.bind(this))        // GET - bind to the 'getTarget` method below
      .on('set', this.setTargetPos.bind(this));       // SET - bind to the 'setTarget` method below

    // register handlers for the PositionState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .on('get', this.getPosState.bind(this));       // GET - bind to the 'getPosState` method below
    
    // EXAMPLE ONLY
    // Example showing how to update the state of a Characteristic asynchronously instead
    // of using the `on('get')` handlers.
    //
    // Here we change update the brightness to a random value every 5 seconds using 
    // the `updateCharacteristic` method.
    /*
    setInterval(() => {
      // assign the current brightness a random value between 0 and 100
      const currentBrightness = Math.floor(Math.random() * 100);

      // push the new value to HomeKit
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, currentBrightness);

      this.platform.log.debug('Pushed updated current Brightness state to HomeKit:', currentBrightness);
    }, 10000);
    */
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getCurrentPos(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const currentPosition = this.shadeStates.currentPosition;

    this.platform.log.debug('Get Characteristic CurrentPos ->', currentPosition);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, currentPosition);
  }

  getTargetPos(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const targetPosition = this.shadeStates.targetPosition;

    this.platform.log.debug('Get Characteristic TargetPos ->', targetPosition);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, targetPosition);
  }

  getPosState(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const posState = this.shadeStates.positionState;

    this.platform.log.debug('Get Characteristic PositionState ->', posState);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, posState);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  setTargetPos(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to set the brightness
    this.shadeStates.targetPosition = value as number;

    this.platform.log.debug('Set Characteristic Target Position -> ', value);

    // you must call the callback function
    callback(null);
  }
}
