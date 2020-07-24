import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { DooyaHomebridgePlatform } from './platform';

enum D {
  ANY = -1,
  REQ_Q = 0,   // 1
  XMIT_Q = 1,  // 2
  XMITTER = 2, // 4
  OTHER = 3,   // 8
  TICK = 4,    // 16
}

enum PosState {
  Decreasing = 0, // Opening
  Increasing = 1, // Closing
  Stopped = 2
}
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DooyaAccessory {
  private service: Service;
  private swServiceOpen: Service;
  private swServiceClose: Service;

  private enabled: boolean;         // When false, the shade never moves or appears to move in the app

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private currentPosition: number; // 0-100, 100 is fully open, 0 is fully closed
  private targetPosition: number;
  public positionState: number;   // 0 - decreasing, 1 - increasing, 2 - stopped
  private silent: boolean;         // When true the shade is moving, but commands are not sent

  private swOpenOn: boolean;
  private swCloseOn: boolean;

  // Particular to the Accessory
  private id: string; // Place UUID here for reference
  private displayName: string;
  private channelNum: number;  // Channel number 0-15, 0 is All channels
  private channelCode: string; // Comman separated HEX characters
  private groupCode: boolean;  // When true this channel/shade moves all shades in the group
  private maxTime: number;     // time to go from 0 to 100% or revers in secs
  private calibrateStartTime = 0; 
  private calibrateStartPos = 0;


  // Common to the platform
  private fixedCode: string; // Comman separated HEX characters
  private openCode: string; // Appended to <fixedCode><channelCode> to make a "row"
  private closeCode: string; // Add *<n> to transmit row <n> times
  private stopCode: string; // "C1*2 C3*4" xmit row ending C1 2 times, ending CC 4 times

  private stopCmdString = ''; // Full string to send on Stop
  private openCmdString = ''; // Full string to send on Open
  private closeCmdString = ''; // Full string to send on Close

  private debounce: number;    
  private debounceObject;
  /* ms of debounce time for Set Target Position.
   * When scrubbing the target position in the Home app
   * several Set Target calls may be made. We only 
   * act after no new calls have been received for
   * <debounce> ms.
  */
  private tickTime: number;    // # of ms that shade takes to move 1%
  private tickerObject;

  constructor(
    private readonly platform: DooyaHomebridgePlatform,
    private readonly accessory: PlatformAccessory) {

    this.displayName = this.accessory.context.device.displayName;
    this.enabled = this.accessory.context.device.enabled;
    this.debounce = this.platform.config.debounce;
    this.fixedCode = this.platform.config.fixedCode;
    this.openCode = this.platform.config.openCode;
    this.closeCode = this.platform.config.closeCode;
    this.stopCode = this.platform.config.stopCode;
    
    this.id = this.accessory.UUID;
    this.channelNum = this.accessory.context.device.channelNum;
    this.channelCode = this.accessory.context.device.channelCode;
    this.groupCode = this.accessory.context.device.groupCode;
    if (this.groupCode) {
      this.platform.setGroupObject(this);
    } 
    this.maxTime = this.accessory.context.device.maxTime; // In seconds
    this.tickTime = this.maxTime * 10; // Nominal setting, calibrator updates it.
    this.silent = false;
    
    this.createCmdStrings();
  
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Dooya')
      .setCharacteristic(this.platform.Characteristic.Model, 'Shades')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '0000-0000');

    // get the WindowCovering service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.WindowCovering) 
                || this.accessory.addService(this.platform.Service.WindowCovering);
    
    this.swServiceOpen = <Service>this.accessory.getServiceById(this.platform.Service.Switch, 'Open');
    if (!this.swServiceOpen) {
      this.swServiceOpen = new this.platform.Service.Switch(this.displayName + ' Open', 'Open');
      if (this.swServiceOpen) {
        this.swServiceOpen = this.accessory.addService(this.swServiceOpen);
        this.logCh(D.ANY, 'New Open Switch Service');
      } else {
        this.logCh(D.ANY, 'New Open Switch Service -- Failed!');
      }
    } 
    this.swServiceClose = <Service>this.accessory.getServiceById(this.platform.Service.Switch, 'Close');
    if (!this.swServiceClose) {
      this.swServiceClose = new this.platform.Service.Switch(this.displayName + ' Close', 'Close');
      if (this.swServiceClose) {
        this.swServiceClose = this.accessory.addService(this.swServiceClose);
        this.logCh(D.ANY, 'New Close Switch Service');
      } else {
        this.logCh(D.ANY, 'New Close Switch Service -- Failed!');
      }
    } 
    
    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayName);

    this.targetPosition = 100;
    if (accessory.context.tP >= 0 && accessory.context.tP <= 100) {
      this.targetPosition = accessory.context.tP;
    }

    this.currentPosition = this.targetPosition;
    this.positionState = PosState.Stopped; // Aways start assuming shade is not moving

    this.swOpenOn = false;
    this.swCloseOn = false;

    this.logState();

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
        
    // Set Handlers for Open/Close switches
    this.swServiceOpen.getCharacteristic(this.platform.Characteristic.On)!
      .on('set', this.setSwitchOpen.bind(this))       // SET - bind to the 'setSwitchOpen` method below
      .on('get', this.getSwitchOpen.bind(this));       // SET - bind to the 'getSwitchOpen` method below

    this.swServiceClose.getCharacteristic(this.platform.Characteristic.On)!
      .on('set', this.setSwitchClose.bind(this))       // SET - bind to the 'setSwitchClose` method below
      .on('get', this.getSwitchClose.bind(this));       // SET - bind to the 'getSwitchClose` method below

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
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  setSwitchOpen(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.enabled && !this.groupCode) {
      callback(new Error('Disabled'));
      return;
    }

    this.swOpenOn = value as boolean;
    if (this.swOpenOn) {
      this.updateTarget(100, false);
      this.setTargetDebounced(); // Start an Open operation
    } else {
      this.stopMoving();
    }
    this.logTimeCh(D.ANY, 'setSwitchOpen ' + this.swOpenOn);
    callback(null);
  }

  getSwitchOpen(callback: CharacteristicGetCallback) {
    this.logTimeCh(D.OTHER, 'getSwitchOpen ' + this.swOpenOn);
    callback(null, this.swOpenOn);
  }

  setSwitchClose(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.enabled && !this.groupCode) {
      callback(new Error('Disabled'));
      return;
    }
    
    this.swCloseOn = value as boolean;
    if (this.swCloseOn) {
      this.updateTarget(0, false);
      this.setTargetDebounced(); // Start an Open operation
    } else {
      this.stopMoving();
    }
    this.logTimeCh(D.ANY, 'setSwitchClose ' + this.swCloseOn);
    callback(null);
  }

  getSwitchClose(callback: CharacteristicGetCallback) {
    this.logTimeCh(D.OTHER, 'getSwitchClose ' + this.swCloseOn);
    callback(null, this.swCloseOn);
  }

  getCurrentPos(callback: CharacteristicGetCallback) {

    this.logTimeCh(D.OTHER, 'Get Characteristic CurrentPos: ' + this.currentPosition);
    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.currentPosition);
  }

  getTargetPos(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    this.logTimeCh(D.OTHER, 'Get Characteristic TargetPos: ' + this.targetPosition);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.targetPosition);
  }

  getPosState(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    this.logTimeCh(D.OTHER, 'Get Characteristic PositionState: ' + this.positionState);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.positionState);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Target Position
   */
  setTargetPos(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.enabled && !this.groupCode) {
      callback(new Error('Disabled'));
      return;
    }
    
    // Go ahead and set, will not be acted upon until debounce is complete
    this.updateTarget(value as number, true);

    this.logTimeCh(D.ANY, 'Set Target on ' + this.displayName + 
               ' To ' + value + 
               ' in ' + this.debounce + 
               'ms');
    
    if (this.debounceObject !== null) {
      clearTimeout(this.debounceObject);
    }
    this.debounceObject = setTimeout(this.setTargetDebounced.bind(this), this.debounce);  

    // you must call the callback function
    callback(null);
  }

  setTargetDebounced(){
    if (this.groupCode) {
      this.setTargetPosGroupDebounced();
    } else {
      this.setTargetPosDebounced();
    }
  }

  setTargetPosDebounced() {
    /*
     * This is not a group shade.
     * Find the group shade and update its target position.
     */
    if (!this.enabled) {
      this.updateTarget(PosState.Stopped, false);
      return;
    }

    this.silent = false;
    this.executeSetTarget();
  }

  setTargetPosGroupDebounced() {
    /*
     * if target is 0 or 100 send the group command
     *   setGroupTarget(t, silent) to each member of the group
     * else if 0 < target < 100
     *   setGroupTarget(t, !silent) to each member of the group
     *   run this group device in silent mode
     */
    if (!this.enabled) {
      this.silent = true;
    } else if (this.targetPosition === 0 || this.targetPosition === 100) {
      /*
       * The target is either fully open or closed, so we DO  
       * send the open or close signal on the Group channel.
       * We set the target on each other shade in the group
       * but with silent operation.
       * 
       * Silent means we go though all the motions of counting, but
       * do not transmit codes. So, when the group channel is silent, 
       * the other channels are not and vice versa.
       */
      this.silent = false;
    } else {
      /*
       * The target is neither fully open nor closed, so we do not 
       * send the open or close signal on the Group channel
       * Instead we set the target on each other shade in the group.
       */
      this.silent = true;
    }
    for (let index = 0; index < this.platform.dooyaObjects.length; index++) {
      const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
      if (this.id !== dooya.id) { 
        // Set all other DooyaAccessory except this one
        dooya.setGroupTarget(this.targetPosition, !this.silent);
      }
    }
    this.executeSetTarget();
  }
  
  // When non-group shades get a new target, they call this method so that the 
  // group shade can update its target
  updateGroupTarget() {
    // Other shades are moving, make the 'group' position an average
    const len = this.platform.dooyaObjects.length;
    let total = 0;

    // First find the average target position of the non-group shades
    for (let index = 0; index < len; index++) {
      const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
      if (!dooya.groupCode) { 
        // Set all other DooyaAccessory except this one
        total += dooya.currentPosition;
      }
    }
    // Now set that as the target, beware divide by zero.
    if (len > 1) {
      this.currentPosition = Math.floor(total / (len-1));
    } else {
      this.currentPosition = 50; // Should be impossible
    }
    this.updateTarget(this.currentPosition, false);
    this.updateCurrent();
    this.logTimeCh(D.OTHER, 'updateGroupTarget: ' + this.targetPosition + '  current: ' + this.currentPosition);
  }

  areNonGroupShadesStopped(): boolean {
    // Check the non-group shades, return false if any are moving
    for (let index = 0; index < this.platform.dooyaObjects.length; index++) {
      const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
      if (!dooya.groupCode && dooya.positionState !== PosState.Stopped) { 
        return false;
      }
    }
    return true;
  }

  setGroupTarget(value: number, silent: boolean) {
    // An internal call from a "group" channel that effects all shades
    // silent means to send no commands, just do tick operations
    if (!this.enabled) {
      return;
    }
    this.logTimeCh(D.ANY, 'setGroupTarget ' + value + ' on ' + this.displayName);
    if (value < 0) {
      value = 0;
    } else if (value > 100) {
      value = 100;
    } else {
      value = Math.floor(value);
    }
    
    if (this.groupCode) {
      // Can't really happen
      this.logTimeCh(D.ANY, 'Error - setGroupTarget called on a Group channel');
    } else {
      this.updateTarget(value, false);
      this.silent = silent;
      this.executeSetTarget(); 
    }
  }
  
  executeSetTarget() {
    this.logTimeCh(D.OTHER, 'executeSetTarget: ' + this.targetPosition);
    if (this.targetPosition === 0) {
      // Closing
      this.updateState(PosState.Decreasing);
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.closeCmdString, this.startMoving.bind(this), this.channelNum);
      }
    } else if (this.targetPosition === 100) {
      // Opening
      this.updateState(PosState.Increasing);
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.openCmdString, this.startMoving.bind(this), this.channelNum);
      }
    } else if (this.targetPosition === this.currentPosition) {
      // At correct position
      // we check for 0 or 100 first because we want to send 
      // a code regardless of whether we think the shade is 
      // already positioned. Because we don't really know where it is.
      this.stopMoving();
    } else if (this.targetPosition > this.currentPosition) {
      // Opening
      this.updateState(PosState.Increasing);
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.openCmdString, this.startMoving.bind(this), this.channelNum);
      }
    } else { // this.targetPosition < this.currentPosition)
      // Closing
      this.updateState(PosState.Decreasing);
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.closeCmdString, this.startMoving.bind(this), this.channelNum);
      }
    }
    this.logShadeState(D.OTHER, 'executeSetTarget');
  }

  tick() {
    if (this.silent) {
      if (this.groupCode) {
        if (this.areNonGroupShadesStopped()) {
          // We have to stop too
          this.positionState = PosState.Stopped;
          this.currentPosition = this.targetPosition;
        }
      } else { // !this.groupCode
        // If a non-group shade and running silently, watch the group shade for a "stop"
        if (this.platform.isGroupShadeStopped()) {
          // We have to stop too
          this.positionState = PosState.Stopped;
          this.currentPosition = this.targetPosition;
        }
      }
    }
    if (this.positionState === PosState.Decreasing) {
      // Closing, Decreasing
      this.currentPosition -= 1;
    } else if (this.positionState === PosState.Increasing) {
      // Opening, Increasing
      this.currentPosition += 1;
    }
    if (this.currentPosition < 0) {
      this.logTimeCh(D.ANY, 'currentPosition Error: ' + this.currentPosition);
      this.currentPosition = 0;
    } else if (this.currentPosition > 100) {
      this.logTimeCh(D.ANY, 'currentPosition Error: ' + this.currentPosition);
      this.currentPosition = 100;
    }
    
    if (this.currentPosition === 0 
    || this.currentPosition === 100
    || this.currentPosition === this.targetPosition
    || this.positionState === PosState.Stopped) {
      this.stopMoving();
    }
  }
  
  startMoving() {
    //this.logTimeCh('startMoving ', this.tickTime);
    this.currentPosition = Math.floor(this.currentPosition); // Make certain an integer comparison 
    this.targetPosition = Math.floor(this.targetPosition);   // does not fail because of a fraction
    this.calibrateStartPos = this.currentPosition; // Used by newTickTime
    this.calibrateStartTime = this.platform.now(); // Used by newTickTime

    if (this.tickerObject !== null) {
      clearInterval(this.tickerObject);
    }
    this.showTick();
    this.tickerObject = setInterval(this.tick.bind(this), this.tickTime);
    this.adjustSwitches();
  }

  stopMoving() {
    this.logTimeCh(D.ANY, 'stopMoving');
    this.tickTime = this.newTickTime(this.currentPosition, this.tickTime);
    this.updateTarget(this.currentPosition, false);
    this.updateState(PosState.Stopped);
    this.updateCurrent();
    if (this.currentPosition > 0 && this.currentPosition < 100) {
      if (!this.silent) {
        this.platform.queueToXmitter(this.stopCmdString, this.dummyCallback.bind(this), this.channelNum); // No callback needed
      }
    }
    this.silent = false;
    this.showTick();
    if (this.tickerObject !== null) {
      clearInterval(this.tickerObject);
      this.tickerObject = null;
    }
    // Let the group channel update its targetPosition
    if (!this.silent && !this.groupCode) {
      this.platform.dooyaGroupObject.updateGroupTarget(); 
    }
    this.adjustSwitches();
  }

  newTickTime(pos: number, prevTickTime: number): number {
    const expected = this.sigDigits((Math.abs(pos - this.calibrateStartPos) / 100) * this.maxTime, 2);
    const actual = this.sigDigits((this.platform.now() - this.calibrateStartTime), 2); // Get seconds since reportStart
    const result = this.sigDigits(expected / actual, 2);
    this.logTimeCh(D.TICK, 'newTickTime ' + result + ' = ' + expected + '/' + actual + ' => ' + prevTickTime*result);
    return this.sigDigits(prevTickTime * result, 0);
  } // newTickTime
  
  adjustSwitches() {
    if (this.silent) {
      // Switches stay off during silent running
      if (this.swCloseOn) {
        this.swCloseOn = false;
        this.updateSwitchClose();
      }
      if (this.swOpenOn) {
        this.swCloseOn = false;
        this.updateSwitchClose();
      }
    } else if (this.positionState === PosState.Decreasing) {
      // Closing
      if (!this.swCloseOn) {
        this.swCloseOn = true;
        this.updateSwitchClose();
      }
      if (this.swOpenOn) {
        this.swCloseOn = false;
        this.updateSwitchClose();
      }
    } else if (this.positionState === PosState.Increasing) {
      // Opening
      if (this.swCloseOn) {
        this.swCloseOn = false;
        this.updateSwitchClose();
      }
      if (!this.swOpenOn) {
        this.swOpenOn = true;
        this.updateSwitchOpen();
      }
    } else { // this.positionState === PosState.Stopped
      // Stopped
      if (this.swCloseOn) {
        this.swCloseOn = false;
        this.updateSwitchClose();
      }
      if (this.swOpenOn) {
        this.swOpenOn = false;
        this.updateSwitchOpen();
      }
    }
  }

  showTick() {
    this.logTimeCh(D.TICK, 
      'Tick State (' + 
                   this.currentPosition + ', ' + 
                   this.targetPosition + ', ' + 
                   this.positionState + ') Tick Timing (' + 
                   this.maxTime + ', ' + 
                   this.tickTime + ')',
    );
  }

  updateState(newSetting: PosState) {
    if (newSetting !== this.positionState) {
      this.positionState = newSetting;
      const s = 'Ch[' + this.channelNum + '] updateState ' + this.positionState;
      this.platform.requestUpdateSlot(s, this.updateStateCB.bind(this));
      this.logTimeCh(D.OTHER, 'Update state... ' + this.positionState);
    }
  }

  updateStateCB() {
    this.logTimeCh(D.OTHER, 'Update state: ' + this.positionState);
    this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.positionState);
  }
  
  updateCurrent() {
    if (this.positionState === PosState.Stopped) {
      this.logTimeCh(D.OTHER, 'Update Current... ' + this.currentPosition);
    }
    const s = 'Ch[' + this.channelNum + '] updateCurrent ' + this.currentPosition;
    this.platform.requestUpdateSlot(s, this.updateCurrentCB.bind(this));
  }

  updateCurrentCB() {
    if (this.positionState === PosState.Stopped) {
      this.logTimeCh(D.OTHER, 'Update current: ' + this.currentPosition);
    }
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.currentPosition);
  }

  updateTarget(newSetting: number, localOnly: boolean) {
    if (newSetting !== this.targetPosition) {
      this.targetPosition = newSetting;
      this.accessory.context.tP = this.targetPosition; // Preserve across restarts
      if (!localOnly) {
        this.logTimeCh(D.OTHER, 'Update Target... ' + this.targetPosition);
        const s = 'Ch[' + this.channelNum + '] updateTarget ' + this.targetPosition;
        this.platform.requestUpdateSlot(s, this.updateTargetCB.bind(this));
      }
    }
  }

  updateTargetCB() {
    this.logTimeCh(D.OTHER, 'Update target: ' + this.targetPosition);
    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition).updateValue(this.targetPosition);
  }

  updateSwitchOpen() {
    const s = 'Ch[' + this.channelNum + '] updateSwitchOpen ' + this.swOpenOn;
    this.platform.requestUpdateSlot(s, this.updateSwitchOpenCB.bind(this));
  }

  updateSwitchOpenCB() {
    this.logTimeCh(D.OTHER, 'Update Open: ' + this.swOpenOn);
    this.swServiceOpen.getCharacteristic(this.platform.Characteristic.On).updateValue(this.swOpenOn);
  }

  updateSwitchClose() {
    const s = 'Ch[' + this.channelNum + '] updateSwitchClose ' + this.swCloseOn;
    this.platform.requestUpdateSlot(s, this.updateSwitchCloseCB.bind(this));
  }

  updateSwitchCloseCB() {
    this.logTimeCh(D.OTHER, 'Update Close: ' + this.swCloseOn);
    this.swServiceClose.getCharacteristic(this.platform.Characteristic.On).updateValue(this.swCloseOn);
  }

  dummyCallback() {
    return;
  }

  /*send(s: string) {
    this.platform.queueToXmitter(s);
    this.platform.log.info('Send ' + s);
  }
*/
  /*
  * Combine the fixed, channel and command codes to make the full strings for open, close and stop
  *
  * A Delay and a stop code can be concatenated to make a "position" string
  */
  createCmdStrings() {
    let cmds = [''];
    cmds = this.openCode.split(' ');
    this.openCmdString = '';
    for (const c of cmds) {
      this.openCmdString = this.openCmdString + '+' + this.fixedCode + this.channelCode + c;
    }  
    cmds = this.closeCode.split(' ');
    this.closeCmdString = '';
    for (const c of cmds) {
      this.closeCmdString = this.closeCmdString + '+' + this.fixedCode + this.channelCode + c;
    }  
    cmds = this.stopCode.split(' ');
    this.stopCmdString = '';
    for (const c of cmds) {
      this.stopCmdString = this.stopCmdString + '+' + this.fixedCode + this.channelCode + c;
    }
  }

  logState() {
    this.logCh(D.ANY, 'Dooya shade state: (' + this.currentPosition +
                           ', ' + this.targetPosition +
                           ', ' + this.positionState + ')');
    
    this.log(D.ANY, 'Dooya shade: (' + this.displayName +
                           ', ' + this.id +
                           ', ' + this.channelNum +
                           ', ' + this.channelCode +
                           ', ' + this.maxTime +
                           ', ' + this.groupCode + ')');
 
    this.log(D.ANY, 'Dooya platform: (' + this.fixedCode +
                           ', ' + this.openCode +
                           ', ' + this.closeCode +
                           ', ' + this.stopCode + ')');
    this.log(D.ANY, 'Dooya Open Channel:  ' + this.channelNum + ' (' + this.openCmdString + ')');
    this.log(D.ANY, 'Dooya Close Channel: ' + this.channelNum + ' (' + this.closeCmdString + ')');
    this.log(D.ANY, 'Dooya Stop Channel:  ' + this.channelNum + ' (' + this.stopCmdString + ')');
  }

  logTimeCh(d: D, s: string) {
    if (this.debug(d)) {
      this.platform.log.info(this.platform.now().toFixed(6) + ': Ch ' + this.channelNum.toFixed(0) + ': ' + s);
    }
  }

  logCh(d: D, s: string) {
    if (this.debug(d)) {
      this.platform.log.info('Ch ' + this.channelNum.toFixed(0) + ': ' + s);
    }
  }

  log(d: D, s :string) {
    if (this.debug(d)) {
      this.platform.log.info('Ch ' + this.channelNum.toFixed(0) + ': ' + s);
    }
  }

  logShadeState(d: D, n: string) {
    this.logTimeCh(d, n + this.displayName + ' (' + 
    this.currentPosition + ', ' + 
    this.targetPosition + ', ' + 
    this.positionState + ') silent: ' +
    this.silent);
  }

  debug(d: D): boolean {
    return this.platform.debug(d);
  }

  sigDigits(x: number, d: number): number {
    const raise = Math.pow(10, Math.floor(d));
    return Math.round(x * raise) / raise;
  }
}
