const net = require('net');
const { buffer } = require('stream/consumers');

const users = [];
let nextID = 1; // Start with ServerID 0x00000001

class User {
    constructor(connection, ip) {
        this.serverID = assignServerID();
        this.logged = false;
        this.username = '';
        this.password = '';
        this.avatarData = null;
        this.idName = '';
        this.idLocation = '';
        this.idEmail = '';
        this.status = '';
        this.buddyList = [];
        this.connection = connection;
        this.sByte = 129;
        this.ip = ip;
        this.buffer = Buffer.alloc(0);
    }

    getServerIDBytes() {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(this.serverID);
        return buffer;
    }
}

const assignServerID = () => nextID++;

const addUser = (user) => users.push(user);

const removeUser = (user) => {
    const index = users.findIndex(u => u.serverID === user.serverID);
    if (index >= 0) {
        users.splice(index, 1);
        console.log(`User ${user.serverID.toString(16).padStart(8, '0')} removed`);
    }
};

function findUser(username) {
    return users.findIndex(u => u.username.toLowerCase() === username.toString().toLowerCase());
}

const ipToBytes = (ip) => {
    console.log("Input IP:", ip);

    // Check if it's an IPv4-mapped IPv6 address
    if (ip.startsWith("::ffff:")) {
        ip = ip.slice(7); // Extract the IPv4 part after "::ffff:"
    }

    const parts = ip.split('.').map(Number);

    // Validate the IP format and range
    if (parts.length !== 4 || parts.some(part => part < 0 || part > 255)) {
        throw new Error('Invalid IPv4 address');
    }

    return Buffer.from(parts);
};

const startServer = async () => {
    try {
        console.log(`Server started on port 1533`);

        const server = net.createServer(handleConnection);
        server.listen(1533);
    } catch (err) {
        console.error('Error starting server:', err);
    }
};

const handleConnection = (socket) => {
    const remoteAddr = socket.remoteAddress;
    const ipBytes = ipToBytes(remoteAddr);
    const user = new User(socket, ipBytes);
    addUser(user);

    console.log(`New user connected: ServerID ${user.serverID.toString(16).padStart(8, '0')}`);
    sendOut(user, Buffer.from(ipBytes, 'ascii'));

    socket.on('data', (data) => {
        user.buffer = Buffer.concat([user.buffer, data]);
        handleData(user);
    });

    socket.on('close', () => {
        console.log(`User ${user.serverID.toString(16).padStart(8, '0')} disconnected`);
        removeUser(user);
    });

    socket.on('error', (err) => console.error(`Error on connection with user ${user.serverID}:`, err));
};

function handleData (user) {
    if (user.buffer[0] === 128) {
        user.connection.write(buffer[0]);
        user.buffer = user.buffer.slice(1);
    }

    if (user.buffer.length < 5) return;

    const packetLength = UFBL(user.buffer.slice(1, 5));
    if (packetLength < 5) return;

    const packetData = user.buffer.slice(5, packetLength);
    processPacket(user.buffer[0], packetData, user);

    user.buffer = user.buffer.slice(packetLength + 5);
    if (user.buffer.length > 0) { handleData(user); }
};

function parsePacket(buffer) {
    if (buffer.length < 5) return null; // Packet too short to contain meaningful data.

    const sByte = buffer[0];
    const length = UFBL(buffer.slice(1, 5)); // Extract packet length.

    if (buffer.length < 5 + length) return null; // Wait for the full packet to arrive.

    const packetData = buffer.slice(5, 5 + length);
    return { sByte, length, packetData, totalLength: 5 + length };
}

function handleData(user) {
    while (user.buffer.length > 0) {
        const packet = parsePacket(user.buffer);
        if (!packet) break; // Incomplete packet, wait for more data.

        const { sByte, packetData, totalLength } = packet;
        user.buffer = user.buffer.slice(totalLength); // Remove processed packet from buffer.
        processPacket(sByte, packetData, user);
    }
}

function processPacket (sByte, clientPacket, user) {
    let response = Buffer.alloc(0);
    const userID = user.getServerIDBytes();

    console.log(`${user.serverID} IN ${sByte}: ${AsciiString(clientPacket)}`);
    if (!user.logged) {
        switch (sByte) {
            case 129:
                response = Buffer.concat([
                    Buffer.from([0, 0, 0, 0, 3, 0, 1, 0, 3, 0, 0, 0, 0, 1, 32, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 4, 1, 33, 0, 0, 0, 1, 255, 255, 255, 255, 0, 0, 10, 112, 1, 71, 0, 0, 0, 0, 255, 255, 255, 255, 0, 3, 5, 3, 251, 0, 0, 3, 232, 0, 7, 79, 112, 101, 110, 80, 65, 76, 0, 3, 233, 0, 7, 104, 116, 116, 112, 58, 47, 47, 0, 0, 0, 0]),
                ]);
                sendOut(user, response);
                break;
            case 130:
                if (clientPacket.length < 5) {
                    console.log("Error: Packet too short to contain valid data.");
                    return;
                }
            
                // Skipping the fixed part (0 11 0 0 0)
                const fixedPart = clientPacket.slice(0, 5);
                console.log("Fixed part:", fixedPart); // For debugging
            
                // Extract the username length from the next 2 bytes
                const usernameLength = UTBL(clientPacket.slice(5, 7));
                if (clientPacket.length < 7 + usernameLength) {
                    console.log("Error: Packet too short to contain username.");
                    return;
                }
                const username = clientPacket.slice(7, 7 + usernameLength).toString('utf-8');
                console.log("Username:", username); // For debugging
                // Extract the password length
                const passwordLength = UTBL(clientPacket.slice(14 + usernameLength, 16 + usernameLength));
                console.log("Pass Length:", passwordLength); // For debugging

                if (clientPacket.length < 10 + usernameLength + passwordLength) {
                    console.log("Error: Packet too short to contain password.");
                    return;
                }
                const password = clientPacket.slice(16 + usernameLength, 18 + usernameLength + passwordLength).toString('utf-8');
                console.log("Password:", password); // For debugging
            
                // Now, set the user's credentials
                user.username = username;
                user.password = password;
            
                const part1 = Buffer.from([0, 12, 0, 0, 0]);
                const part2 = userID;
                const part3 = TBL(user.username);
                const part4 = Buffer.from([1, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0]);
            
                // Combine all parts into a single packet
                response = Buffer.concat([part1, part2, part3, part4]);
                sendOut(user, response);
                break;
            case 132:
                const urlLength = UTBL(clientPacket.slice(13, 15));
                const urlBytes = clientPacket.slice(15, 15 + urlLength);
                
                console.log(`${urlLength} ${AsciiString(urlBytes)}`);
                
                // Construct the first response packet
                response = Buffer.concat([
                    Buffer.from([0, 15, 0, 0, 1]), // Fixed header
                    userID,                        // User ID (Buffer)
                    Buffer.from([0, 3, 0, 0, 0, 38, 8, 128]), // Fixed part
                    TBL(urlBytes),                 // URL bytes with length
                    Buffer.from([
                        1, 1, 0, 0, 0, 40, 0, 0, 0, 39, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    ]),
                ]);
                sendOut(user, response);
                
                // Construct the second response packet
                response = Buffer.concat([
                    Buffer.from([0, 29, 0]),       // Fixed header
                    userID,                        // User ID (Buffer)
                    Buffer.from([
                        0, 0, 10, 114, 0, 104, 0, 0, 0, 0, 0, 0, 0, 0, 10, 112,
                    ]),
                ]);
                sendOut(user, response);
                
                user.logged = true;
                break;                
        }
    } else {
        switch(clientPacket[1]) {
        case 28: //PAL Functions
            switch (clientPacket[12]) {
                case 65: //Add Buddy
                    buddyNameText = clientPacket.slice(21, clientPacket.length - 4);
                    console.log(`User Added: ${buddyNameText.length} ${buddyNameText}`);
                    findBuddy = findUser(buddyNameText);
                    if (findBuddy >= 0) { 
                        buddyID = users[findBuddy].getServerIDBytes();
                        console.log(`User Online: ${AsciiString(buddyID)} ${buddyNameText}`);

                        response = Buffer.concat([
                            Buffer.from([0, 29, 0]),       // Fixed header
                            userID,                        // User ID (Buffer)
                            Buffer.from([0, 0, 10, 114, 48, 111, 0, 0, 0, 0, 0, 12, 1]),
                            TBL(buddyNameText),
                            buddyID,
                            Buffer.from([0, 0, 10, 112])]);
                        sendOut(user, response); 
                    }

                    break;
                case 82: //Remove Buddy
                    buddyNameText = clientPacket.slice(21, clientPacket.length - 4);
                    console.log(`User Removed: ${buddyNameText.length} ${buddyNameText}`);
                    break;

                case 83: // Buddylist send
                    const friendCount = UTBL(clientPacket.slice(24, 26));
                    console.log(`Buddylist: ${friendCount} friends`);
                    let buddyBegin = 26;
                
                    for (let i = 0; i < friendCount; i++) {
                        const tempBuddyNameSize = UTBL(clientPacket.slice(buddyBegin, buddyBegin + 2));
                        buddyBegin += 2;
                
                        const tempBuddyName = clientPacket.slice(buddyBegin, buddyBegin + tempBuddyNameSize).toString('utf-8');
                        buddyBegin += tempBuddyNameSize;
                
                        console.log(`Buddylist: ADD ${tempBuddyName}`);

                        findBuddy = findUser(tempBuddyName);
                        if (findBuddy >= 0) { 
                            buddyID = users[findBuddy].getServerIDBytes();
                            console.log(`Sending User Online for ${AsciiString(buddyID)} ${tempBuddyName} to ${AsciiString(userID)} ${user.username}`);

                            response = Buffer.concat([
                                Buffer.from([0, 29, 0]),       // Fixed header
                                userID,                        // User ID (Buffer)
                                Buffer.from([0, 0, 10, 114, 48, 111, 0, 0, 0, 0, 0, 12, 1]),
                                TBL(tempBuddyName),
                                buddyID,
                                Buffer.from([0, 0, 10, 112])]);
                            sendOut(user, response); 
                        }
                    }
                    break;
                

                    break;

                default:
                    console.log(`Unknown type: ${clientPacket[12]}`);
                    break;

            }
            break;
        }
    }
};

function sendOut (user, data) {
    if (!user.connection) {
        console.error('User is not connected');
        return;
    }

    const packet = Buffer.concat([Buffer.from([user.sByte]), FBL(data)]);
    user.connection.write(packet);

    user.sByte = user.sByte === 255 ? 129 : user.sByte + 1;

    console.log(`OUT: ${AsciiString(packet)}`);
};

function FBL(theString) {
    const lengthBuffer = Buffer.from(fourByteLength(theString.length));
    const stringBuffer = Buffer.from(theString, 'ascii');

    return Buffer.concat([lengthBuffer, stringBuffer]);
}

function TBL(theString) {
    const lengthBuffer = Buffer.from(twoByteLength(theString.length));
    const stringBuffer = Buffer.from(theString, 'ascii');

    return Buffer.concat([lengthBuffer, stringBuffer]);
}

function UFBL(buffer) {
    // Ensure the input is a valid byte array (expected length of 4 bytes)
    if (buffer.length !== 4) {
        console.error("UFBL expects a 4-byte buffer.");
        return;
    }

    let a = buffer[0] * (256 ** 3);
    let b = buffer[1] * (256 ** 2);
    let c = buffer[2] * 256;
    let d = buffer[3];
    return a + b + c + d;
}

function UTBL(buffer) {
    // Ensure the input is a valid byte array (expected length of 2 bytes)
    if (buffer.length !== 2) {
        console.error("UTBL expects a 2-byte buffer.");
        return;
    }

    const a = buffer[0] * 256;
    const b = buffer[1];
    return a + b;
}

function fourByteLength(uintPacketSize) {
    let chrPacketHeader = new Uint8Array(4);

    chrPacketHeader[0] = (uintPacketSize >> 24) & 0xFF; // Calculate the highest byte
    chrPacketHeader[1] = (uintPacketSize >> 16) & 0xFF; // Calculate the second highest byte
    chrPacketHeader[2] = (uintPacketSize >> 8) & 0xFF;  // Calculate the second lowest byte
    chrPacketHeader[3] = uintPacketSize & 0xFF;         // Calculate the lowest byte

    return chrPacketHeader;
}

function twoByteLength(uintPacketSize) {
    if (uintPacketSize > 65535) {
        throw new RangeError("Packet length cannot exceed 65,535 bytes.");
    }

    let chrPacketHeader = new Uint8Array(2);

    chrPacketHeader[0] = (uintPacketSize >> 8) & 0xFF; // Calculate the high byte
    chrPacketHeader[1] = uintPacketSize & 0xFF;        // Calculate the low byte

    return chrPacketHeader;
}

function AsciiString(byteArray) {
    if (!Array.isArray(byteArray) && !(byteArray instanceof Uint8Array)) {
        console.error("Input must be a ByteArray or Uint8Array.");
        return "";
    }

    // Convert each byte in the array to its ASCII value
    return Array.from(byteArray).join(' ');
}

startServer();