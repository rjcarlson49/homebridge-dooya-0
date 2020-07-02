import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { DooyaHomebridgePlatform } from './platform';

enum PosState {
  Decreasing = 0, // Opening
  Increasing = 1, // Closing
  Stopped = 2     // Stopped
}
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DooyaAccessory {
  private service: Service;
  //private swServiceOpen: Service;
  //private swServiceClose: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private currentPosition: number; // 0-100, 100 is fully open, 0 is fully closed
  private targetPosition: number;
  private positionState: number;   // 0 - decreasing, 1 - increasing, 2 - stopped
  private silent: boolean;         // When true the shade is moving, but commands are not sent

  private switchPosOpen: boolean;
  private switchPosClose: boolean;

  // Particular to the Accessory
  private id: string; // Place UUID here for reference
  private displayName: string;
  private channelNum: number;  // Channel number 0-15, 0 is All channels
  private channelCode: string; // Comman separated HEX characters
  private groupCode: boolean;  // When true this channel/shade moves all shades in the group
  private maxTime: number;     // time to go from 0 to 100% or revers in secs
  private tickFudge: number;   // Fudge factor to correct 'tick' timing. Typically this is around .8

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
    this.debounce = this.platform.config.debounce;
    this.tickFudge = this.platform.config.tickFudge;
    this.fixedCode = this.platform.config.fixedCode;
    this.openCode = this.platform.config.openCode;
    this.closeCode = this.platform.config.closeCode;
    this.stopCode = this.platform.config.stopCode;
    
    this.id = this.accessory.UUID;
    this.channelNum = this.accessory.context.device.channelNum;
    this.channelCode = this.accessory.context.device.channelCode;
    this.groupCode = this.accessory.context.device.groupCode; 
    this.maxTime = this.accessory.context.device.maxTime; // In seconds
    this.tickTime = this.maxTime * 10 - this.tickFudge; // Number of ms in 1% of maxTime
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
    
    //this.swServiceOpen = this.accessory.getService(this.platform.Service.Switch) 
    //                  || this.accessory.addService(this.platform.Service.Switch, this.displayName + ' Open', 'Open');
    
    //this.swServiceClose = this.accessory.getService(this.platform.Service.Switch)
    //                  || this.accessory.addService(this.platform.Service.Switch), this.displayName + ' Close', 'Close';

    //this.swServiceOpen.displayName = this.displayName + ' Open';
    //this.swServiceOpen.subtype = 'Open';
    //this.swServiceClose.displayName = this.displayName + ' Close';
    //this.swServiceClose.subtype = 'Close';
    
    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayName);

    //this.swServiceOpen.setCharacteristic(this.platform.Characteristic.Name, this.displayName + ' Open');
    //this.swServiceClose.setCharacteristic(this.platform.Characteristic.Name, this.displayName + ' Close');
    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    this.targetPosition = 100;
    if (accessory.context.tP >= 0 && accessory.context.tP <= 100) {
      this.targetPosition = accessory.context.tP;
    }

    this.currentPosition = this.targetPosition;
    this.positionState = PosState.Stopped; // Aways start assuming shade is not moving

    this.switchPosOpen = false;
    this.switchPosClose = false;

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
    
    /*
    this.swServiceOpen.getCharacteristic(this.platform.Characteristic.On)!
      .on('set', this.setSwitchOpen.bind(this))       // SET - bind to the 'setSwitchOpen` method below
      .on('get', this.getSwitchOpen.bind(this));       // SET - bind to the 'getSwitchOpen` method below

    this.swServiceClose.getCharacteristic(this.platform.Characteristic.On)!
      .on('set', this.setSwitchClose.bind(this))       // SET - bind to the 'setSwitchClose` method below
      .on('get', this.getSwitchClose.bind(this));       // SET - bind to the 'getSwitchClose` method below
    */

    this.updateState();
    this.updateTarget();
    this.updateCurrent();
  
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
  setSwitchOpen(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.switchPosOpen = value as boolean;
    this.logCh('setSwitchOpen ' + this.switchPosClose);
    callback(null);
  }

  getSwitchOpen(callback: CharacteristicGetCallback) {
    this.logCh('getSwitchOpen ' + this.switchPosClose);
    callback(null, this.switchPosOpen);
  }

  setSwitchClose(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.switchPosClose = value as boolean;
    this.logCh('setSwitchClose ' + this.switchPosClose);
    callback(null);
  }

  getSwitchClose(callback: CharacteristicGetCallback) {
    this.logCh('getSwitchClose ' + this.switchPosClose);
    //callback(null, this.switchPosClose);
  }

  getCurrentPos(callback: CharacteristicGetCallback) {

    this.logCh('Get Characteristic CurrentPos: ' + this.currentPosition);
    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.currentPosition);
  }

  getTargetPos(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    this.logCh('Get Characteristic TargetPos: ' + this.targetPosition);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.targetPosition);
  }

  getPosState(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    this.logCh('Get Characteristic PositionState: ' + this.positionState);

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
    
    // Go ahead and set, will not be acted upon until debounce is complete
    this.targetPosition = value as number;
    this.accessory.context.tP = this.targetPosition; // Preserve across restarts

    this.logCh('Set Target on ' + this.displayName + 
               ' To ' + value + 
               ' in ' + this.debounce + 
               'ms');
    
    if (this.debounceObject !== null) {
      clearTimeout(this.debounceObject);
    }
    this.debounceObject = setTimeout(this.debounceComplete.bind(this), this.debounce);  

    // you must call the callback function
    callback(null);
  }

  debounceComplete() {
    /*
     * Determine if we have a group channel or not
     * If Group
     *    if target is 0 or 100 send the group command
     *       setGroupTarget(t, silent) to each member of the group
     *    else if 0 < target < 100
     *       setGroupTarget(t, !silent) to each member of the group
     *       run this group device in silent mode
     * Else
     *   Proceed normally
     */
    if (this.groupCode) {
      this.debounceCompleteGroup();
    } else {
      this.silent = false;
      this.executeSetTarget();
      // Find the group shade and adjust its target
      for (let index = 0; index < this.platform.dooyaObjects.length; index++) {
        const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
        if (dooya.groupCode) { 
          // Set the group accessory silently
          dooya.updateGroupTarget();
        }
      }
    }
  }

  debounceCompleteGroup() {
    // This is the group channel that affects all channels (shades)
    if (this.targetPosition === 0 || this.targetPosition === 100) {
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
    this.executeSetTarget();
    for (let index = 0; index < this.platform.dooyaObjects.length; index++) {
      const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
      if (this.id !== dooya.id) { 
        // Set all other DooyaAccessory except this one
        dooya.setGroupTarget(this.targetPosition, !this.silent);
      }
    }
  }
  
  updateGroupTarget() {
    const len = this.platform.dooyaObjects.length;
    let total = 0;

    for (let index = 0; index < len; index++) {
      const dooya = <unknown>this.platform.dooyaObjects[index] as DooyaAccessory;
      if (!dooya.groupCode) { 
        // Set all other DooyaAccessory except this one
        total += dooya.targetPosition;
      }
    }
    if (len > 1) {
      this.targetPosition = Math.floor(total / (len-1));
    } else {
      this.targetPosition = 50; // Should be impossible
    }
    this.logCh('updateGroupTarget: ' + this.targetPosition + '  current: ' + this.currentPosition);
    this.silent = true;
    this.executeSetTarget();
  }
  
  setGroupTarget(value: number, silent: boolean) {
    // An internal call from a "group" channel that effects all shades
    // silent means to send no commands, just do tick operations
    this.logCh('setGroupTarget ' + value + ' on ' + this.displayName);
    if (value < 0) {
      value = 0;
    } else if (value > 100) {
      value = 100;
    } else {
      value = Math.floor(value);
    }
    
    if (this.groupCode) {
      // Can't really happen
    } else {
      this.targetPosition = value;
      this.silent = silent;
      this.executeSetTarget(); // The signal is already debounced
    }
  }
  
  executeSetTarget() {
    this.logCh('executeSetTarget: ' + this.targetPosition);
    if (this.groupCode && this.silent) {
      /* 
       * If it's the group channel and silent, just upate to 
       * the new state. Don't count silently.
       */
      this.currentPosition = this.targetPosition;
      this.positionState = PosState.Stopped;
      this.updateState();
      this.updateCurrent();
      this.updateTarget();
    } else if (this.targetPosition === 0) {
      // Closing
      this.positionState = PosState.Decreasing; // Decreasing
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.closeCmdString, this.startMoving.bind(this), this.channelNum);
      }
    } else if (this.targetPosition === 100) {
      // Opening
      this.positionState = PosState.Increasing; // Increasing
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
      this.positionState = PosState.Stopped;
      this.stopMoving();
    } else if (this.targetPosition > this.currentPosition) {
      // Opening
      this.positionState = PosState.Increasing; // Increasing
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.openCmdString, this.startMoving.bind(this), this.channelNum);
      }
      
    } else { // this.targetPosition < this.currentPosition)
      // Closing
      this.positionState = PosState.Decreasing; // Decreasing
      if (this.silent) {
        this.startMoving();
      } else {
        this.platform.queueToXmitter(this.closeCmdString, this.startMoving.bind(this), this.channelNum);
      }
    }
    this.logShadeState('executeSetTarget');
  }

  tick() {
    if (this.positionState === PosState.Decreasing) {
      // Closing, Decreasing
      this.currentPosition -= 1;
    } else if (this.positionState === PosState.Increasing) {
      // Opening, Increasing
      this.currentPosition += 1;
    } else { // posState 2 - Stopped
      // Should never happen
      this.currentPosition = this.targetPosition;
      this.stopMoving();
    }
    if (this.currentPosition < 0) {
      this.logCh('currentPosition Error: ' + this.currentPosition);
      this.currentPosition = 0;
      this.stopMoving();
    } else if (this.currentPosition > 100) {
      this.logCh('currentPosition Error: ' + this.currentPosition);
      this.currentPosition = 100;
      this.stopMoving();
    }
    //this.updateCurrent();
    
    if (this.currentPosition === 0 
    || this.currentPosition === 100
    || this.currentPosition === this.targetPosition) {
      this.stopMoving();
    }
  }

  showTick() {
    this.logTimeCh('Tick State (' + 
                   this.currentPosition + ', ' + 
                   this.targetPosition + ', ' + 
                   this.positionState + 
                   ') tickTime ' + this.tickTime);
  }

  updateState() {
    this.platform.requestUpdateSlot('Ch[' + this.channelNum + '] updateState', this.updateStateCB.bind(this));
    if (this.groupCode) {
      this.logTimeCh('Update state...');
    }
  }

  updateStateCB() {
    this.service.getCharacteristic(this.platform.Characteristic.PositionState).updateValue(this.positionState);
    this.logTimeCh('Update state:' + this.positionState);
  }
  
  updateCurrent() {
    this.platform.requestUpdateSlot('Ch[' + this.channelNum + '] updateCurrent', this.updateCurrentCB.bind(this));
    if (this.groupCode) {
      this.logTimeCh('Update Current...');
    }
  }

  updateCurrentCB() {
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition).updateValue(this.currentPosition);
    if (this.groupCode) {
      this.logTimeCh('Update current:' + this.currentPosition);
    }
  }

  updateTarget() {
    this.platform.requestUpdateSlot('Ch[' + this.channelNum + '] updateTarget', this.updateTargetCB.bind(this));
    if (this.groupCode) {
      this.logTimeCh('Update Target...');
    }
  }

  updateTargetCB() {
    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition).updateValue(this.targetPosition);
    if (this.groupCode) {
      this.logTimeCh('Update target:' + this.targetPosition);
    }
  }

  startMoving() {
    //this.logCh('startMoving ', this.tickTime);
    this.currentPosition = Math.floor(this.currentPosition);
    this.targetPosition = Math.floor(this.targetPosition);

    this.updateState();
    if (this.tickerObject !== null) {
      clearInterval(this.tickerObject);
    }
    this.showTick();
    this.tickerObject = setInterval(this.tick.bind(this), this.tickTime);
  }

  stopMoving() {
    this.logCh('Stopped');
    //this.platform.log.info('stopMoving');
    this.positionState = PosState.Stopped;
    this.updateState();
    this.updateCurrent();
    if (this.currentPosition > 0 && this.currentPosition < 100) {
      if (!this.silent) {
        this.platform.queueToXmitter(this.stopCmdString, this.dummyCallback.bind(this), this.channelNum); // No callback needed
      }
    }
    this.silent = false;
    this.showTick();
    if (this.tickerObject === null) {
      return;
    }
    clearInterval(this.tickerObject);
    this.tickerObject = null;
  }

  dummyCallback() {

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
    this.logCh('Dooya shade state: (' + this.currentPosition +
                           ', ' + this.targetPosition +
                           ', ' + this.positionState + ')');
    
    this.log('Dooya shade: (' + this.displayName +
                           ', ' + this.id +
                           ', ' + this.channelNum +
                           ', ' + this.channelCode +
                           ', ' + this.maxTime +
                           ', ' + this.groupCode + ')');
 
    this.log('Dooya platform: (' + this.fixedCode +
                           ', ' + this.openCode +
                           ', ' + this.closeCode +
                           ', ' + this.stopCode + ')');
    this.log('Dooya Open Channel:  ' + this.channelNum + ' (' + this.openCmdString + ')');
    this.log('Dooya Close Channel: ' + this.channelNum + ' (' + this.closeCmdString + ')');
    this.log('Dooya Stop Channel:  ' + this.channelNum + ' (' + this.stopCmdString + ')');
  }

  logTimeCh(s: string) {
    this.platform.log.info(String(this.platform.now()) + ': Ch ' + this.channelNum + ': ' + s);
  }

  logCh(s: string) {
    this.platform.log.info('Ch ' + this.channelNum + ': ' + s);
  }

  log(s :string) {
    this.platform.log.info('Ch ' + this.channelNum + ': ' + s);
  }

  logShadeState(n: string) {
    this.logCh(n + this.displayName + ' (' + 
    this.currentPosition + ', ' + 
    this.targetPosition + ', ' + 
    this.positionState + ') silent: ' +
    this.silent);
  }
}
