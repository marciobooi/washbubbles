var net = require('net');
var fs = require('fs');
var path = require('path');
var ioClient = require('socket.io-client');
var io = require('socket.io')();
var jwtDecode = require('jwt-decode');
var cmd = require('node-cmd');

// Low level connection parameters.
var filePath = path.join(__dirname, 'vm-token.txt');
var laundryID = null;

//var host = '127.0.0.1'; // NOTE: low level IP address
var port = 16852;   // NOTE: low level port
var host = '192.168.2.201'; // NOTE: low level IP address


var appPort = 3300;
var lowLevelConn = new net.Socket();

var vmClient = null;
var mdClient = null;

var wsToken = null;

// COMMENT TO DISABLE ACTIVATION MSG
var inactivity = true;
var inactivityTimer = null;
var inactivityDur = 2*60*1000; //5*1000; // 2min
var timeoutDur = 1.5*60*1000; //1*1000; // 1min30s
function sendActivationReq() {
	setTimeout(function() {
		if (inactivity) {
			var pkg = { op: 'has-card' };
			var dataLength = JSON.stringify(pkg).length;
			var pkgLength = dataLength + dataLength.toString().length + 14;
			var newPkg = {
			  cl: pkgLength.toString(),
			  c: pkg,
			};
			lowLevelConn.write(JSON.stringify(newPkg));
		}
		sendActivationReq();
	}, timeoutDur);
}
// COMMENT TO DISABLE ACTIVATION MSG

// Vending machine <-> Low level communication setup.
io.listen(appPort);
lowLevelConn.connect(port, host, function() {

  // COMMENT TO DISABLE ACTIVATION MSG
  sendActivationReq();
  // COMMENT TO DISABLE ACTIVATION MSG

  console.log('LOG: Connected to low-level successfully');  
});
lowLevelConn.on('error', function () {
  console.log('ERROR: Unable to connect to low-level.');

  setTimeout(function () {
    console.log('LOG: Trying to reconnect to low-level.');
    if (lowLevelConn.destroyed) {		
      lowLevelConn.connect(port, host, function() { 
        console.log('LOG: Connected to low-level successfully');
      });
    }
  }, 5000);
});
lowLevelConn.on('close', function () {
  setTimeout(function () {
    if (lowLevelConn.destroyed) {
      lowLevelConn.connect(port, host, function() {
        console.log('LOG: Connected to low-level successfully');
      });
    }
  }, 5000);
});

io.on('connection', function(client){
  console.log('VM connected.');

  // NOTE: Handle vending machine token ----------------------------------------
  // Send vending machine token to browser app (NOTE: only if this is the
  // browser of the vending machine).
  fs.readFile(path.join(__dirname, 'vm-token.txt'), function(err, data) {
    var vmToken = null;
    if (!err) {
      vmToken = data.toString();
    }
    client.emit('SET_VM_TOKEN', vmToken);
  });

  // Delete vending machine token.
  client.on('DELETE_VM_TOKEN', function() {
    fs.exists(path.join(__dirname, 'vm-token.txt'), function(exists) {
      if(exists) {
        fs.unlink(path.join(__dirname, 'vm-token.txt'));
      }
    });
  });

  // Save vending machine token.
  client.on('SAVE_VM_TOKEN', function(vmToken) {
    fs.writeFile(path.join(__dirname, 'vm-token.txt'), vmToken);
  });

  client.on('set-localstorage', function(data) {
    fs.writeFile(path.join(__dirname, 'local-storage.txt'), JSON.stringify(data));
  });

  client.on('get-localstorage', function() {
    fs.readFile(path.join(__dirname, 'local-storage.txt'), function(err, data) {
      if (!err) {
        try {
          client.emit('SET_LOCAL_STORAGE', JSON.parse(data.toString()));
        } catch (err) {}
      }
    });
  });

  client.on('set-offline-serv', function(data) {
    fs.writeFile(path.join(__dirname, 'offline-serv.txt'), JSON.stringify(data));
  });

  client.on('get-offline-serv', function() {
    fs.readFile(path.join(__dirname, 'offline-serv.txt'), function(err, data) {
      if (!err) {
        try {
          client.emit('SET_OFFLINE_SERV', JSON.parse(data.toString()));
        } catch (e) {}
      }
    });
  });
  
  client.on('shutdown', function() {
	  console.log('------------ Shutting Down --------------');
	  cmd.run('shutdown -s -t 5');
  });

  client.on('reboot', function() {
	  console.log('------------ Rebooting --------------');
	  cmd.run('shutdown /r /t 00');
  });

  client.on('update', function() {
    console.log('------------ Updating VM --------------');
    cmd.run('START /min CMD /C CALL "C:/washStationProject/update-webapp.bat"');
  });
  
  client.on('remote-credits-res', function(pkg) {
	if (mdClient) {
    // TODO: check if this 'pkg' should be sent to the cloud app...
		try
		{
			// console.log('remote credit');
			// console.log(JSON.stringify(pkg));
			
		  // JSON.parse(JSON.stringify(pkg));
		  mdClient.emit('send1', pkg);
		}
		catch(e) {}
	}
  });  
  // ---------------------------------------------------------------------------

  client.on('pkg', function(pkg) {
    var dataLength = JSON.stringify(pkg).length;
    var pkgLength = dataLength + dataLength.toString().length + 14;
    var newPkg = {
      cl: pkgLength.toString(),
      c: pkg,
    };
    lowLevelConn.write(JSON.stringify(newPkg));  // NOTE: Add 5 white spaces

    // COMMENT TO DISABLE ACTIVATION MSG
    inactivity = false;
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(function() {
      inactivity = true;
    }, inactivityDur);
    // COMMENT TO DISABLE ACTIVATION MSG

// // logs.
// console.log('---------------------------------------/n');
// console.log('VM --> Low-level');
// console.log(JSON.stringify(newPkg));
// console.log('---------------------------------------/n');
  });
  vmClient = client;
});

// Handle incoming requests from low level.
lowLevelConn.on('data', function(pkg) {
  if (vmClient) {
    // // Logs.
    // console.log('---------------------------------------/n');
    // console.log('Low-level --> VM');
    // console.log(pkg.toString());
    // console.log('---------------------------------------/n');

		try
		{
		  JSON.parse(pkg.toString());
		  vmClient.emit('middleware-pkg', pkg.toString());
		}
		catch(e) {}
  }
  if (mdClient) {
    // TODO: check if this 'pkg' should be sent to the cloud app...
		try
		{
		  JSON.parse(pkg.toString());
		  mdClient.emit('send1', JSON.parse(pkg.toString()));
		}
		catch(e) {}
  }
});


fs.readFile(filePath, function(err, data) {
  if (err) return;
  laundryID = jwtDecode(data.toString()).laundryId;

  wsToken = data.toString();

  // Connect to the websocket server.
  mdClient = ioClient('wss://wsapi.washstation.pt', { reconnection: true });
  mdClient.on('connect', function() {
    console.log('Cloud connected.');

    if (laundryID) {	  
      mdClient.emit('subscribe', { room: 'cloud.' + laundryID, vm: true });
    }
  }).emit('authenticate', { token: wsToken });

  mdClient.on('reconnect', function(){
    console.log('Cloud reconnected.');
    mdClient.emit('authenticate', { token: wsToken });
  });

  mdClient.on('reboot', function() {
    console.log('------------ Rebooting Remote --------------');
    cmd.run('shutdown /r /t 00');
  });

  mdClient.on("disconnect", function(){
    console.log('Cloud disconnected');
  });

  mdClient.on('send', function(pkg) {
    if (typeof pkg === 'object') {		
      try { 
		if (pkg.hasOwnProperty('op') && pkg.op === 'remote-credits') {
			if (vmClient) {
				try {
					// // Logs.
					// console.log('---------------------------------------/n');
					// console.log('WEBAPP --> VM');
					// console.log(JSON.stringify(pkg));
					// console.log('---------------------------------------/n');
					
					vmClient.emit('middleware-pkg', JSON.stringify(pkg));
				} catch(e) {}
			}			
		} else {
			var dataLength = JSON.stringify(pkg).length;
			var pkgLength = dataLength + dataLength.toString().length + 14;
			var newPkg = {
			  cl: pkgLength.toString(),
			  c: pkg,
			};
				
			// // logs.
			// console.log('---------------------------------------/n');
			// console.log('WEBAPP --> Low-level');
			// console.log(JSON.stringify(newPkg));
			// console.log('---------------------------------------/n');
			
			lowLevelConn.write(JSON.stringify(newPkg));  // NOTE: Add 5 white spaces			
		}
      } catch(e) {}
    }	
  });
});
